import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { StreamerManager, type StreamerRuntime } from "./streamer-runtime.js";
import { TwitchAuth } from "./twitch-auth.js";

const root = process.cwd();
const publicDirectory = path.join(root, "public");
const pendingDirectory = path.join(root, "data", "pending-auth");
const sessionSecret = config.sessionSecret || crypto.randomBytes(32).toString("hex");
if (!config.sessionSecret && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production.");
if (!config.sessionSecret) console.warn("SESSION_SECRET is not set. Login sessions will reset whenever the server restarts.");

const manager = new StreamerManager(root, config.game, config.twitch);
const pendingAuth = new Map<string, { auth: TwitchAuth; filePath: string; expiresAt: number }>();
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "6mb" }));

app.get("/control", requireLoginPage, (_request, response) => response.sendFile(path.join(publicDirectory, "control.html")));
app.get("/control.html", requireLoginPage, (_request, response) => response.redirect("/control"));
app.get("/overlay/:key", (request, response) => {
  if (!manager.forOverlay(request.params.key)) { response.status(404).send("Overlay not found."); return; }
  response.sendFile(path.join(publicDirectory, "overlay.html"));
});
app.use(express.static(publicDirectory));

app.get("/health", (_request, response) => response.json({ ok: true, streamers: manager.size }));
app.get("/api/session", (request, response) => {
  const runtime = runtimeFor(request);
  response.json(runtime ? {
    authenticated: true,
    login: runtime.profile.login,
    connected: runtime.game.twitchConnected,
    overlayPath: `/overlay/${runtime.profile.overlayKey}`,
  } : { authenticated: false, connected: false });
});
app.get("/api/state", requireRuntime, (request, response) => response.json(runtimeFor(request)!.game.state()));
app.get("/api/overlay/:key/state", (request, response) => {
  const runtime = manager.forOverlay(request.params.key);
  if (!runtime) { response.status(404).json({ error: "Overlay not found." }); return; }
  response.json(runtime.game.state());
});
app.get("/api/settings", requireRuntime, (request, response) => response.json(runtimeFor(request)!.settings.get()));
app.get("/api/languages", requireRuntime, (request, response) => {
  try { response.json(runtimeFor(request)!.languageList()); }
  catch (error) { response.status(500).json({ error: (error as Error).message }); }
});
app.put("/api/settings", requireRuntime, (request, response) => {
  try { response.json(runtimeFor(request)!.updateSettings(request.body ?? {})); }
  catch (error) { response.status(422).json({ error: (error as Error).message }); }
});
app.post("/api/languages", requireRuntime, (request, response) => {
  try {
    const language = runtimeFor(request)!.installLanguage(request.body?.name, request.body?.flag, request.body?.contents);
    response.status(201).json(language);
  } catch (error) {
    response.status(422).json({ error: (error as Error).message });
  }
});
app.delete("/api/languages/:id", requireRuntime, (request, response) => {
  try {
    runtimeFor(request)!.removeLanguage(String(request.params.id));
    response.json({ ok: true });
  } catch (error) {
    response.status(422).json({ error: (error as Error).message });
  }
});
app.post("/api/overlay/regenerate", requireRuntime, (request, response) => {
  const runtime = runtimeFor(request)!;
  const overlayKey = manager.regenerateOverlayKey(runtime.profile.userId);
  response.json({ overlayPath: `/overlay/${overlayKey}` });
});

app.get("/api/twitch/status", (request, response) => {
  const runtime = runtimeFor(request);
  response.json({
    configured: Boolean(config.twitch.clientId && config.twitch.clientSecret && config.twitch.redirectUri),
    authenticated: Boolean(runtime?.auth.login),
    signedIn: Boolean(runtime),
    connected: runtime?.game.twitchConnected ?? false,
    login: runtime?.profile.login ?? null,
    redirectUri: config.twitch.redirectUri,
    overlayPath: runtime ? `/overlay/${runtime.profile.overlayKey}` : null,
  });
});
app.get("/auth/twitch", (_request, response) => {
  try {
    fs.mkdirSync(pendingDirectory, { recursive: true });
    const filePath = path.join(pendingDirectory, `${crypto.randomUUID()}.json`);
    const auth = new TwitchAuth(config.twitch, filePath);
    const authorization = auth.beginAuthorization();
    pendingAuth.set(authorization.state, { auth, filePath, expiresAt: Date.now() + 10 * 60_000 });
    prunePendingAuth();
    response.redirect(authorization.url);
  } catch (error) {
    response.status(503).send((error as Error).message);
  }
});
app.get("/auth/twitch/callback", async (request, response) => {
  const state = String(request.query.state ?? "");
  const pending = pendingAuth.get(state);
  pendingAuth.delete(state);
  try {
    if (request.query.error) throw new Error(String(request.query.error_description ?? request.query.error));
    if (!pending || pending.expiresAt < Date.now()) throw new Error("Login expired. Start the Twitch connection again.");
    const credentials = await pending.auth.exchangeCode(String(request.query.code ?? ""), state);
    const runtime = await manager.adoptAuthentication(pending.filePath, credentials.userId, credentials.login);
    setSessionCookie(request, response, runtime.profile.userId);
    response.redirect("/control?connected=1");
  } catch (error) {
    if (pending?.filePath) try { fs.unlinkSync(pending.filePath); } catch { /* Nothing to clean up. */ }
    console.error("Twitch connection failed:", (error as Error).message);
    response.status(400).send(`Twitch connection failed: ${(error as Error).message}`);
  }
});
app.post("/api/twitch/disconnect", requireRuntime, (request, response) => {
  runtimeFor(request)!.disconnect();
  response.json({ ok: true });
});
app.post("/api/logout", (_request, response) => {
  response.setHeader("Set-Cookie", "lc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  response.json({ ok: true });
});
app.post("/api/guess", requireRuntime, (request, response) => {
  const username = String(request.body?.username ?? "local-player").trim().slice(0, 25) || "local-player";
  const result = runtimeFor(request)!.game.submit(`local:${username.toLocaleLowerCase()}`, username, String(request.body?.word ?? ""));
  response.status(result.accepted ? 200 : 422).json(result);
});
app.post("/api/round/end", requireRuntime, (request, response) => {
  const runtime = runtimeFor(request)!;
  if (!runtime.game.twitchConnected) { response.status(409).json({ error: "Twitch chat is not connected." }); return; }
  runtime.game.endRound();
  response.json(runtime.game.state());
});
app.post("/api/round/new", requireRuntime, (request, response) => {
  const runtime = runtimeFor(request)!;
  if (!runtime.game.twitchConnected) { response.status(409).json({ error: "Twitch chat is not connected." }); return; }
  runtime.game.startRound();
  response.json(runtime.game.state());
});
app.post("/api/dev/start", requireRuntime, (request, response) => {
  const runtime = runtimeFor(request)!;
  runtime.game.start();
  response.json(runtime.game.state());
});

const server = app.listen(config.port, () => {
  console.log(`Letter Chatters: http://localhost:${config.port}`);
  console.log(`Loaded ${manager.size} streamer account${manager.size === 1 ? "" : "s"}.`);
  console.log(config.twitch.clientId && config.twitch.clientSecret && config.twitch.redirectUri
    ? "Twitch app credentials found."
    : "Twitch setup required: add credentials to .env.");
});
const webSockets = new WebSocketServer({ server });
webSockets.on("connection", (client, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const runtime = url.pathname === "/live" ? manager.forOverlay(url.searchParams.get("overlay") ?? "") : undefined;
  if (!runtime) { client.close(1008, "Unknown overlay"); return; }
  runtime.clients.add(client);
  client.send(JSON.stringify(runtime.game.state()));
  client.on("close", () => runtime.clients.delete(client));
});

void manager.resumeAll();

const shutdown = () => {
  manager.stopAll();
  webSockets.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function runtimeFor(request: Request): StreamerRuntime | undefined {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("lc_session="));
  if (!cookie) return undefined;
  const value = decodeURIComponent(cookie.slice("lc_session=".length));
  const [userId, expiresText, signature] = value.split(".");
  const expiresAt = Number(expiresText);
  if (!userId || !Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) return undefined;
  const expected = sign(`${userId}.${expiresText}`);
  if (!safeEqual(signature, expected)) return undefined;
  return manager.get(userId);
}

function requireRuntime(request: Request, response: Response, next: () => void): void {
  if (!runtimeFor(request)) { response.status(401).json({ error: "Sign in with Twitch first." }); return; }
  next();
}

function requireLoginPage(request: Request, response: Response, next: () => void): void {
  if (!runtimeFor(request)) { response.redirect("/?login=required"); return; }
  next();
}

function setSessionCookie(request: Request, response: Response, userId: string): void {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60_000;
  const payload = `${userId}.${expiresAt}`;
  const secure = request.secure ? "; Secure" : "";
  response.setHeader("Set-Cookie", `lc_session=${encodeURIComponent(`${payload}.${sign(payload)}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}

function sign(value: string): string {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function prunePendingAuth(): void {
  for (const [state, pending] of pendingAuth) {
    if (pending.expiresAt >= Date.now()) continue;
    pendingAuth.delete(state);
    try { fs.unlinkSync(pending.filePath); } catch { /* Nothing to clean up. */ }
  }
}
