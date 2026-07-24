import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { Game } from "./game.js";
import { LanguageCatalog } from "./language-catalog.js";
import { ScoreStore } from "./score-store.js";
import { SettingsStore } from "./settings-store.js";
import { TwitchChat } from "./twitch.js";
import { TwitchAuth } from "./twitch-auth.js";

// Both `npm run dev` and the compiled server are launched from the project root.
const root = process.cwd();
const store = new ScoreStore(path.join(root, "data", "scores.json"));
const settings = new SettingsStore(path.join(root, "data", "settings.json"), config.game);
const languages = new LanguageCatalog(path.join(root, "data", "languages"));
let initialLanguages;
try {
  const selected = settings.get().languages.filter((id) => languages.has(id));
  const selectedIds = selected.length > 0 ? selected : ["english"];
  if (selectedIds.join("|") !== settings.get().languages.join("|")) settings.update({ languages: selectedIds });
  initialLanguages = languages.getMany(selectedIds);
} catch (error) {
  console.error("Could not load selected languages; using English:", (error as Error).message);
  settings.update({ languages: ["english"] });
  initialLanguages = languages.getMany(["english"]);
}
const game = new Game(initialLanguages.dictionary, store, settings.get(), initialLanguages.languages);
const auth = new TwitchAuth(config.twitch, path.join(root, "data", "twitch-auth.json"));
const twitch = new TwitchChat(game);
const app = express();

app.use(express.json());
app.use(express.static(path.join(root, "public")));
app.get("/", (_request, response) => response.redirect("/control.html"));
app.get("/overlay", (_request, response) => response.sendFile(path.join(root, "public", "overlay.html")));
app.get("/control", (_request, response) => response.sendFile(path.join(root, "public", "control.html")));
app.get("/health", (_request, response) => response.json({ ok: true, twitch: game.twitchConnected }));
app.get("/api/state", (_request, response) => response.json(game.state()));
app.get("/api/settings", (_request, response) => response.json(settings.get()));
app.get("/api/languages", (_request, response) => {
  try { response.json(languages.list()); }
  catch (error) { response.status(500).json({ error: (error as Error).message }); }
});
app.put("/api/settings", (request, response) => {
  const before = settings.get();
  const patch = { ...(request.body ?? {}) };
  const requestedLanguages = Array.isArray(patch.languages)
    ? patch.languages
    : typeof patch.language === "string" ? [patch.language] : before.languages;
  patch.languages = [...new Set(requestedLanguages.filter((id: unknown): id is string => typeof id === "string" && languages.has(id)))];
  if (patch.languages.length === 0) patch.languages = before.languages;
  delete patch.language;
  const languagesChanged = patch.languages.join("|") !== before.languages.join("|");
  let selectedLanguages;
  if (languagesChanged) {
    try { selectedLanguages = languages.getMany(patch.languages); }
    catch (error) { response.status(422).json({ error: (error as Error).message }); return; }
  }
  const next = settings.update(patch);
  if (selectedLanguages) game.setDictionary(selectedLanguages.dictionary, selectedLanguages.languages);
  const gameplayKeys = ["mode", "roundSeconds", "countdownSeconds", "shuffleSeconds", "timeBonusSeconds", "guessCooldownSeconds", "replaceUsedLetters", "minLetters", "maxLetters", "minimumWords", "levelBaseGoal", "levelGrowth", "dynamicDifficulty", "dynamicPointsPerPlayer"] as const;
  const restartRound = languagesChanged || gameplayKeys.some((key) => before[key] !== next[key]);
  game.configure(next, restartRound);
  response.json(next);
});
app.get("/api/twitch/status", (_request, response) => response.json({
  configured: auth.configured,
  authenticated: Boolean(auth.login),
  connected: game.twitchConnected,
  login: auth.login,
  redirectUri: config.twitch.redirectUri,
}));
app.get("/auth/twitch", (_request, response) => {
  try { response.redirect(auth.authorizationUrl()); }
  catch (error) { response.status(503).send((error as Error).message); }
});
app.get("/auth/twitch/callback", async (request, response) => {
  try {
    if (request.query.error) throw new Error(String(request.query.error_description ?? request.query.error));
    const credentials = await auth.exchangeCode(String(request.query.code ?? ""), String(request.query.state ?? ""));
    twitch.connect(credentials);
    response.redirect("/control?connected=1");
  } catch (error) {
    console.error(error);
    response.status(400).send(`Twitch connection failed: ${(error as Error).message}`);
  }
});
app.post("/api/twitch/disconnect", (_request, response) => {
  twitch.close();
  auth.clear();
  response.json({ ok: true });
});
app.post("/api/guess", (request, response) => {
  const username = String(request.body?.username ?? "local-player").trim().slice(0, 25) || "local-player";
  const userId = `local:${username.toLocaleLowerCase()}`;
  const result = game.submit(userId, username, String(request.body?.word ?? ""));
  response.status(result.accepted ? 200 : 422).json(result);
});
app.post("/api/round/end", (_request, response) => {
  if (!game.twitchConnected) { response.status(409).json({ error: "Twitch chat is not connected." }); return; }
  game.endRound();
  response.json(game.state());
});
app.post("/api/round/new", (_request, response) => {
  if (!game.twitchConnected) { response.status(409).json({ error: "Twitch chat is not connected." }); return; }
  game.startRound();
  response.json(game.state());
});
app.post("/api/dev/start", (_request, response) => {
  game.start();
  response.json(game.state());
});

// Omitting the host lets Node accept both IPv6 localhost and IPv4 connections.
const server = app.listen(config.port, () => {
  const overlay = settings.get();
  console.log(`Letter Chatter control: http://localhost:${config.port}/control`);
  console.log(`OBS browser source:     http://localhost:${config.port}/overlay (${overlay.overlayWidth} x ${overlay.overlayHeight})`);
  console.log(auth.configured ? "Twitch app credentials found." : "Twitch setup required: add the Client ID and Client Secret to .env.");
});
const webSockets = new WebSocketServer({ server, path: "/live" });
webSockets.on("connection", (client) => client.send(JSON.stringify(game.state())));
game.on("change", (state) => {
  const message = JSON.stringify(state);
  for (const client of webSockets.clients) if (client.readyState === client.OPEN) client.send(message);
});

void auth.resume()
  .then((credentials) => credentials && twitch.connect(credentials))
  .catch((error) => console.error("Could not resume Twitch login:", error.message));

const shutdown = () => {
  twitch.close();
  game.stop();
  webSockets.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
