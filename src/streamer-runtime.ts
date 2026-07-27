import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type WebSocket from "ws";
import type { GameSettings, LanguageInfo, PublicGameState } from "./types.js";
import { Game } from "./game.js";
import { LanguageCatalog } from "./language-catalog.js";
import { ScoreStore } from "./score-store.js";
import { SettingsStore } from "./settings-store.js";
import { TwitchAuth } from "./twitch-auth.js";
import { TwitchChat } from "./twitch.js";

export interface StreamerProfile {
  userId: string;
  login: string;
  overlayKey: string;
}

export class StreamerRuntime {
  readonly directory: string;
  readonly customLanguagesDirectory: string;
  readonly auth: TwitchAuth;
  readonly settings: SettingsStore;
  readonly game: Game;
  readonly twitch: TwitchChat;
  readonly clients = new Set<WebSocket>();
  private languages: LanguageCatalog;
  private previousPhase: PublicGameState["phase"] = "setup";
  private previousRound = 0;

  constructor(
    readonly profile: StreamerProfile,
    dataDirectory: string,
    private readonly builtInLanguagesDirectory: string,
    defaults: GameSettings,
    twitchOptions: ConstructorParameters<typeof TwitchAuth>[0],
  ) {
    this.directory = path.join(dataDirectory, "streamers", profile.userId);
    this.customLanguagesDirectory = path.join(this.directory, "languages");
    this.auth = new TwitchAuth(twitchOptions, path.join(this.directory, "twitch-auth.json"));
    this.settings = new SettingsStore(path.join(this.directory, "settings.json"), defaults);
    this.languages = new LanguageCatalog([this.builtInLanguagesDirectory, this.customLanguagesDirectory]);
    const selection = this.selectedLanguages();
    this.game = new Game(
      selection.dictionary,
      new ScoreStore(path.join(this.directory, "scores.json")),
      this.settings.get(),
      selection.languages,
    );
    this.twitch = new TwitchChat(this.game, profile.login);
    this.game.on("change", (state) => {
      this.logLifecycle(state);
      const message = JSON.stringify(state);
      for (const client of this.clients) if (client.readyState === client.OPEN) client.send(message);
    });
  }

  async resume(): Promise<void> {
    const credentials = await this.auth.resume();
    if (credentials) this.twitch.connect(credentials);
  }

  languageList(): Array<LanguageInfo & { custom: boolean }> {
    return this.languages.list().map((language) => ({ ...language, custom: language.id.startsWith("custom-") }));
  }

  updateSettings(input: Record<string, unknown>): GameSettings {
    const before = this.settings.get();
    const patch = { ...input } as Partial<GameSettings>;
    const requestedLanguages = Array.isArray(patch.languages)
      ? patch.languages
      : typeof patch.language === "string" ? [patch.language] : before.languages;
    patch.languages = [...new Set(requestedLanguages.filter((id: unknown): id is string =>
      typeof id === "string" && this.languages.has(id),
    ))];
    if (patch.languages.length === 0) patch.languages = before.languages;
    delete patch.language;
    const languagesChanged = patch.languages.join("|") !== before.languages.join("|");
    const selection = languagesChanged ? this.languages.getMany(patch.languages) : null;
    const next = this.settings.update(patch);
    if (selection) this.game.setDictionary(selection.dictionary, selection.languages);
    const gameplayKeys: Array<keyof GameSettings> = [
      "mode", "roundSeconds", "countdownSeconds", "shuffleSeconds", "timeBonusSeconds",
      "guessCooldownSeconds", "replaceUsedLetters", "minLetters", "maxLetters",
      "minimumWords", "levelBaseGoal", "levelGrowth", "dynamicDifficulty", "dynamicPointsPerPlayer",
    ];
    const restartRound = languagesChanged || gameplayKeys.some((key) => before[key] !== next[key]);
    this.game.configure(next, restartRound);
    return next;
  }

  installLanguage(nameInput: unknown, flagInput: unknown, contentsInput: unknown): LanguageInfo {
    const name = String(nameInput ?? "").trim().slice(0, 40);
    const flag = String(flagInput ?? "🌐").trim().slice(0, 8) || "🌐";
    const contents = String(contentsInput ?? "");
    if (!name) throw new Error("Enter a language name.");
    if (Buffer.byteLength(contents, "utf8") > 5 * 1024 * 1024) throw new Error("Language files are limited to 5 MB.");
    const words = new Set<string>();
    for (const line of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const word = line.trim().normalize("NFC").toLocaleUpperCase();
      if (!word || word.startsWith("#")) continue;
      if (/^\p{L}{3,15}$/u.test(word)) words.add(word);
      if (words.size > 300_000) throw new Error("Language files are limited to 300,000 valid words.");
    }
    if (words.size === 0) throw new Error("The file contains no valid words between 3 and 15 letters.");
    const slug = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "language";
    const id = `custom-${slug}`;
    fs.mkdirSync(this.customLanguagesDirectory, { recursive: true });
    const filePath = path.join(this.customLanguagesDirectory, `${id}.txt`);
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, `# name: ${name}\n# flag: ${flag}\n\n${[...words].sort().join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(temp, filePath);
    this.reloadLanguages();
    return this.languages.get(id).info;
  }

  removeLanguage(id: string): void {
    if (!/^custom-[a-z0-9][a-z0-9-]{0,36}$/.test(id)) throw new Error("Only uploaded languages can be removed.");
    const filePath = path.join(this.customLanguagesDirectory, `${id}.txt`);
    if (!fs.existsSync(filePath)) throw new Error("Language not found.");
    fs.unlinkSync(filePath);
    const nextIds = this.settings.get().languages.filter((languageId) => languageId !== id);
    this.reloadLanguages();
    this.updateSettings({ languages: nextIds.length > 0 ? nextIds : ["english"] });
  }

  disconnect(): void {
    this.twitch.close();
    this.auth.clear();
  }

  stop(): void {
    this.twitch.close();
    this.game.stop();
    for (const client of this.clients) client.close();
  }

  private selectedLanguages() {
    const selected = this.settings.get().languages.filter((id) => this.languages.has(id));
    const selectedIds = selected.length > 0 ? selected : ["english"];
    if (selectedIds.join("|") !== this.settings.get().languages.join("|")) this.settings.update({ languages: selectedIds });
    try {
      return this.languages.getMany(selectedIds);
    } catch (error) {
      console.error(`[${this.profile.login}] Could not load selected languages; using English:`, (error as Error).message);
      this.settings.update({ languages: ["english"] });
      return this.languages.getMany(["english"]);
    }
  }

  private reloadLanguages(): void {
    this.languages = new LanguageCatalog([this.builtInLanguagesDirectory, this.customLanguagesDirectory]);
    const selection = this.selectedLanguages();
    this.game.setDictionary(selection.dictionary, selection.languages);
    this.game.configure(this.settings.get(), true);
  }

  private logLifecycle(state: PublicGameState): void {
    if (state.round !== this.previousRound && (state.phase === "countdown" || state.phase === "playing")) {
      const languages = state.languages.map((language) => language.name).join(" / ");
      const details = state.settings.mode === "level" && state.level
        ? `Level ${state.level.number}, target ${state.level.target} points`
        : state.settings.mode === "time" ? "Time Attack" : "Race";
      console.log(`[${this.profile.login}] Round ${state.round} starting — ${details}; languages: ${languages}.`);
    }
    if (state.phase === "results" && this.previousPhase !== "results") {
      const words = `${state.foundWords.length} unique word${state.foundWords.length === 1 ? "" : "s"}`;
      if (state.settings.mode === "level" && state.level) {
        const result = state.level.success
          ? `victory, cleared ${state.level.levelsCleared} level${state.level.levelsCleared === 1 ? "" : "s"}`
          : "defeat";
        console.log(`[${this.profile.login}] Round ${state.round} ended — ${result}; ${words}.`);
      } else {
        console.log(`[${this.profile.login}] Round ${state.round} ended — ${words}.`);
      }
    }
    this.previousPhase = state.phase;
    this.previousRound = state.round;
  }
}

export class StreamerManager {
  private readonly runtimes = new Map<string, StreamerRuntime>();
  private readonly overlayRuntimes = new Map<string, StreamerRuntime>();
  private readonly dataDirectory: string;
  private readonly streamersDirectory: string;
  private readonly builtInLanguagesDirectory: string;

  constructor(
    root: string,
    private readonly defaults: GameSettings,
    private readonly twitchOptions: ConstructorParameters<typeof TwitchAuth>[0],
  ) {
    this.dataDirectory = path.join(root, "data");
    this.streamersDirectory = path.join(this.dataDirectory, "streamers");
    this.builtInLanguagesDirectory = path.join(this.dataDirectory, "languages");
    this.migrateLegacyData();
    this.load();
  }

  get size(): number {
    return this.runtimes.size;
  }

  get(userId: string): StreamerRuntime | undefined {
    return this.runtimes.get(userId);
  }

  forOverlay(key: string): StreamerRuntime | undefined {
    return this.overlayRuntimes.get(key);
  }

  regenerateOverlayKey(userId: string): string {
    const runtime = this.runtimes.get(userId);
    if (!runtime) throw new Error("Streamer not found.");
    this.overlayRuntimes.delete(runtime.profile.overlayKey);
    runtime.profile.overlayKey = crypto.randomBytes(24).toString("base64url");
    writeJson(path.join(runtime.directory, "profile.json"), runtime.profile);
    this.overlayRuntimes.set(runtime.profile.overlayKey, runtime);
    for (const client of runtime.clients) client.close(1008, "Overlay link changed");
    return runtime.profile.overlayKey;
  }

  async adoptAuthentication(sourceFile: string, userId: string, login: string): Promise<StreamerRuntime> {
    if (!/^\d+$/.test(userId)) throw new Error("Twitch returned an invalid user ID.");
    const existing = this.runtimes.get(userId);
    existing?.stop();
    if (existing) this.overlayRuntimes.delete(existing.profile.overlayKey);
    const directory = path.join(this.streamersDirectory, userId);
    fs.mkdirSync(directory, { recursive: true });
    const profile: StreamerProfile = {
      userId,
      login,
      overlayKey: existing?.profile.overlayKey ?? crypto.randomBytes(24).toString("base64url"),
    };
    writeJson(path.join(directory, "profile.json"), profile);
    fs.copyFileSync(sourceFile, path.join(directory, "twitch-auth.json"));
    fs.unlinkSync(sourceFile);
    const runtime = this.create(profile);
    this.runtimes.set(userId, runtime);
    this.overlayRuntimes.set(profile.overlayKey, runtime);
    await runtime.resume();
    return runtime;
  }

  async resumeAll(): Promise<void> {
    await Promise.allSettled([...this.runtimes.values()].map(async (runtime) => {
      try { await runtime.resume(); }
      catch (error) { console.error(`[${runtime.profile.login}] Could not resume Twitch login:`, (error as Error).message); }
    }));
  }

  stopAll(): void {
    for (const runtime of this.runtimes.values()) runtime.stop();
  }

  private load(): void {
    try {
      for (const entry of fs.readdirSync(this.streamersDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
          const profile = JSON.parse(fs.readFileSync(path.join(this.streamersDirectory, entry.name, "profile.json"), "utf8")) as StreamerProfile;
          if (profile.userId !== entry.name || !profile.login || !profile.overlayKey) continue;
          const runtime = this.create(profile);
          this.runtimes.set(profile.userId, runtime);
          this.overlayRuntimes.set(profile.overlayKey, runtime);
        } catch (error) {
          console.error(`Could not load streamer ${entry.name}:`, (error as Error).message);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private migrateLegacyData(): void {
    const legacyAuth = path.join(this.dataDirectory, "twitch-auth.json");
    if (!fs.existsSync(legacyAuth)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(legacyAuth, "utf8")) as { userId?: string; login?: string };
      if (!saved.userId || !saved.login) return;
      const directory = path.join(this.streamersDirectory, saved.userId);
      const profilePath = path.join(directory, "profile.json");
      fs.mkdirSync(directory, { recursive: true });
      let migrated = false;
      if (!fs.existsSync(profilePath)) {
        writeJson(profilePath, {
          userId: saved.userId,
          login: saved.login,
          overlayKey: crypto.randomBytes(24).toString("base64url"),
        } satisfies StreamerProfile);
        migrated = true;
      }
      for (const name of ["twitch-auth.json", "settings.json", "scores.json"]) {
        const source = path.join(this.dataDirectory, name);
        const target = path.join(directory, name);
        if (!fs.existsSync(source)) continue;
        if (!fs.existsSync(target) || fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs) {
          fs.copyFileSync(source, target);
          migrated = true;
        }
      }
      if (migrated) console.log(`Migrated legacy data for ${saved.login} into the multi-streamer store.`);
    } catch (error) {
      console.error("Could not migrate legacy streamer data:", (error as Error).message);
    }
  }

  private create(profile: StreamerProfile): StreamerRuntime {
    return new StreamerRuntime(profile, this.dataDirectory, this.builtInLanguagesDirectory, this.defaults, this.twitchOptions);
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, filePath);
}
