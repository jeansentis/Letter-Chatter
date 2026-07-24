# Letter Chatter

A compact Twitch chat word game for an OBS browser source. Viewers make English words from the visible letter rack; the first valid guess scores and later duplicate guesses appear in gray for zero points.

## Local setup

1. Install Node.js 20 or newer and run `npm install`.
2. Copy `.env.example` to `.env` (keep the example file free of real credentials).
3. Register a Twitch application and set its OAuth redirect URL to exactly `http://localhost:1010/auth/twitch/callback`.
4. Put the application's Client ID and Client Secret in `.env`.
5. Double-click **Start Letter Chatter.cmd** (or run `npm run dev`), then choose **Connect Twitch** in the dashboard that opens.
6. Add `http://localhost:1010/overlay` to OBS as a browser source. Match its width and height to the values shown in the dashboard.

Double-click **Stop Letter Chatter.cmd** to stop a server launched by the start shortcut.

For a Raspberry Pi, use a current 64-bit Raspberry Pi OS and Node.js 20+. After `npm run build`, `npm start` runs the compiled server. Keep `.env` and `data/twitch-auth.json` private: both contain secrets.

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

Extra language dictionaries live in `data/languages`. See `data/languages/README.md` for the UTF-8 word-list format. English stays available as the built-in default.

The port, initial timing defaults, rack defaults, and OAuth callback remain configurable in `.env`.
