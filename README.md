# Letter Chatters

A compact Twitch chat word game for an OBS browser source. Viewers make English words from the visible letter rack; the first valid guess scores and later duplicate guesses appear in gray for zero points.

## Local setup

1. Install Node.js 20 or newer and run `npm install`.
2. Copy `.env.example` to `.env` (keep the example file free of real credentials).
3. Register a Twitch application and set its OAuth redirect URL to exactly `http://localhost:1010/auth/twitch/callback` for local development.
4. Put the application's Client ID and Client Secret in `.env`.
5. Double-click **Start Letter Chatters.cmd** (or run `npm run dev`), then choose **Connect Twitch** in the dashboard that opens.
6. Copy the private overlay URL from the dashboard into an OBS browser source. Match its width and height to the values shown in the dashboard.

Double-click **Stop Letter Chatters.cmd** to stop a server launched by the start shortcut.

## Raspberry Pi and PM2

The server and all active streamer games run inside one PM2 process named `letters`. This matches the other Pi services:

```sh
cd /path/to/Letter-Chatter
npm ci
npm run build
sudo npm install -g pm2
chmod +x letters
pm2 start letters
pm2 startup
pm2 save
```

The normal commands are:

```sh
pm2 restart letters
pm2 stop letters
pm2 logs letters
pm2 logs
pm2 status
```

`pm2 logs` follows `mot`, `tcs`, and `letters` together. After pulling an update, run `npm ci`, `npm test`, `npm run build`, and `pm2 restart letters`. Run `pm2 save` whenever the saved PM2 process list changes. The service deliberately uses one process: live game state and OBS WebSockets are held in memory, while that process hosts any number of isolated streamer runtimes.

## letterchatter.com

Create the production `.env` on the Pi:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=1010
SESSION_SECRET=generate-a-long-random-value
TWITCH_CLIENT_ID=your-twitch-client-id
TWITCH_CLIENT_SECRET=your-twitch-client-secret
TWITCH_REDIRECT_URI=https://letterchatter.com/auth/twitch/callback
```

Generate the session secret with `openssl rand -hex 32`. Never commit `.env`.

In the Twitch developer console, register `https://letterchatter.com/auth/twitch/callback` as an OAuth redirect URL. It must match `TWITCH_REDIRECT_URI` exactly.

In Cloudflare:

1. Make sure `letterchatter.com` is an active Cloudflare zone.
2. Go to **Networking → Tunnels**, create a Cloudflare Tunnel, and install the displayed `cloudflared` connector command on the Pi.
3. Add a published application route for hostname `letterchatter.com` with service `http://127.0.0.1:1010`. Cloudflare creates the tunnel DNS record.
4. Optionally add `www.letterchatter.com` as another route to the same service, then create a redirect rule from `www` to the apex domain.
5. Do not put a Cloudflare Access login policy in front of this hostname; the Twitch callback and OBS browser sources must reach it directly.

Test locally on the Pi with `curl http://127.0.0.1:1010/health`, then test `https://letterchatter.com/health` externally. The public response should contain `"ok":true`. Open the home page, connect a Twitch broadcaster, copy their private overlay URL into OBS, and verify that a chat message reaches the overlay.

Cloudflare terminates public HTTPS and forwards HTTP through the outbound tunnel to the loopback-only Node service, so port `1010` does not need to be opened on the router.

Keep `.env` and all of `data/streamers` private because they contain Twitch refresh tokens and streamer data. Back up `data/streamers` regularly.

Each Twitch broadcaster gets an isolated directory under `data/streamers/<twitch-user-id>` with their settings, scores, authentication, custom languages, and persistent private overlay key. Existing single-streamer data is copied into this layout automatically on the first multi-streamer start.

## Rules

- A word must contain at least three letters, be in the bundled English word list, and use only the available count of each rack letter.
- A word may use some or all rack letters.
- An accented rack tile can also satisfy its plain form (`Ó` can be used as `O`), but a plain tile cannot satisfy an accented letter (`O` cannot be used as `Ó`).
- The first person to find a word earns `ceil(Scrabble letter value × (1 + word length / 10))` points.
- A repeated word is displayed but earns no points.
- After four seconds without a guess, the word area cycles through already-found words as a visual hint.
- Each viewer has a configurable five-second cooldown after an accepted guess, preventing one chatter from spamming without blocking everyone else.
- **Race** mode lets players compete for as many unique words and points as possible before time expires.
- **Level** mode gives the whole chat a shared score target. Reaching it marks the level won, but play continues through the timer and a final five-second grace period. Extra points carry through the targets for harder levels, so a strong round can advance two or more levels at once. A loss resets the next round to Level 1.
- Optional **Dynamic difficulty** calculates each new Level target from the previous round's unique scoring players. Player growth uses `1 + log2(players)` and Level growth is linear, keeping large chats and later levels gentler. The target stays fixed during the round.
- **Time Attack** starts with the normal round timer and adds five configurable seconds for every unique valid word.
- Every mode shows how many valid unguessed words remain possible on the rack. During a Level, the shared points goal counts down above it.
- Before play, the lobby shows both the number of possible words and their total possible score.
- New racks are checked before they appear and default to a minimum of 25 possible words. Smaller racks are tried more often, and a known-good rack is used if random candidates miss the target.
- Every round begins with a short instructions countdown. During play, the rack reshuffles on a timer and after each accepted word while guessed words remain readable.
- After the first unique guess, a circular five-second rack timer appears. Other viewers can keep guessing with the current rack during this latency window; afterward, the optional replacement setting replaces every tile used by accepted words in that window before reshuffling.
- A word that uses every tile triggers an extra **ALL LETTERS** flash, tile highlight, and particle burst.
- Results rotate between Round, Stream, and All Time leaderboards, showing each top three as a large stacked list.
- The default round is 90 seconds, followed by a 30-second top-three display for the round, stream session, and all time.
- The stream leaderboard resets when the server restarts. All-time scores persist in `data/scores.json`.
- The highest Level record also persists in `data/scores.json` and is shown in the overlay.

The dashboard controls mode, one or more simultaneous languages, viewer cooldown, round and results timing, auto-continue, rack size, fixed or player-scaled level difficulty, browser-source dimensions, typeface, font sizes, bright theme presets, and custom overlay colors. When a valid word belongs to multiple selected dictionaries, every matching flag is shown. These choices persist in `data/settings.json`.

Built-in language dictionaries live in `data/languages`. Streamers can upload their own UTF-8 `.txt` word lists from the dashboard; these remain private to that streamer. See `data/languages/README.md` for the format. English stays available as the built-in default.

The port, initial timing defaults, rack defaults, and OAuth callback remain configurable in `.env`.
