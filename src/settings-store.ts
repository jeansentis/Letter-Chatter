import fs from "node:fs";
import path from "node:path";
import type { FontFamily, GameMode, GameSettings, ThemeName } from "./types.js";

const number = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const integer = (value: unknown, fallback: number, min: number, max: number): number =>
  Math.round(number(value, fallback, min, max));

const color = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

export class SettingsStore {
  private settings: GameSettings;

  constructor(private readonly filePath: string, private readonly defaults: GameSettings) {
    let saved: Partial<GameSettings> = {};
    try {
      saved = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<GameSettings>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Could not load settings:", error);
    }
    this.settings = this.sanitize({ ...defaults, ...saved });
  }

  get(): GameSettings {
    return { ...this.settings, languages: [...this.settings.languages] };
  }

  update(patch: Partial<GameSettings>): GameSettings {
    this.settings = this.sanitize({ ...this.settings, ...patch });
    this.save();
    return this.get();
  }

  private sanitize(input: Partial<GameSettings>): GameSettings {
    const mode: GameMode = input.mode === "level" || input.mode === "time" ? input.mode : "race";
    const fontFamilies: FontFamily[] = ["system", "rounded", "mono", "serif"];
    const themes: ThemeName[] = ["candy", "sunny", "ocean", "lime", "midnight"];
    const fontFamily = fontFamilies.includes(input.fontFamily as FontFamily) ? input.fontFamily as FontFamily : this.defaults.fontFamily;
    const theme = themes.includes(input.theme as ThemeName) ? input.theme as ThemeName : this.defaults.theme;
    const minLetters = integer(input.minLetters, this.defaults.minLetters, 5, 15);
    const maxLetters = Math.max(minLetters, integer(input.maxLetters, this.defaults.maxLetters, 5, 15));
    const legacyLanguage = typeof input.language === "string" ? [input.language] : [];
    const requestedLanguages = legacyLanguage.length > 0 ? legacyLanguage : Array.isArray(input.languages) ? input.languages : [];
    const languages = [...new Set(requestedLanguages
      .filter((value): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(value))
      .map((value) => value.toLowerCase()))].slice(0, 12);
    return {
      mode,
      languages: languages.length > 0 ? languages : [...this.defaults.languages],
      roundSeconds: integer(input.roundSeconds, this.defaults.roundSeconds, 10, 3600),
      countdownSeconds: integer(input.countdownSeconds, this.defaults.countdownSeconds, 3, 30),
      shuffleSeconds: integer(input.shuffleSeconds, this.defaults.shuffleSeconds, 5, 60),
      timeBonusSeconds: integer(input.timeBonusSeconds, this.defaults.timeBonusSeconds, 1, 30),
      guessCooldownSeconds: integer(input.guessCooldownSeconds, this.defaults.guessCooldownSeconds, 1, 30),
      replaceUsedLetters: typeof input.replaceUsedLetters === "boolean" ? input.replaceUsedLetters : this.defaults.replaceUsedLetters,
      autoContinue: typeof input.autoContinue === "boolean" ? input.autoContinue : this.defaults.autoContinue,
      intermissionSeconds: integer(input.intermissionSeconds, this.defaults.intermissionSeconds, 3, 300),
      minLetters,
      maxLetters,
      minimumWords: integer(input.minimumWords, this.defaults.minimumWords, 1, 500),
      levelBaseGoal: integer(input.levelBaseGoal, this.defaults.levelBaseGoal, 50, 10000),
      levelGrowth: number(input.levelGrowth, this.defaults.levelGrowth, 1.05, 3),
      dynamicDifficulty: typeof input.dynamicDifficulty === "boolean" ? input.dynamicDifficulty : this.defaults.dynamicDifficulty,
      dynamicPointsPerPlayer: integer(input.dynamicPointsPerPlayer, this.defaults.dynamicPointsPerPlayer, 5, 1000),
      overlayWidth: integer(input.overlayWidth, this.defaults.overlayWidth, 320, 1920),
      overlayHeight: integer(input.overlayHeight, this.defaults.overlayHeight, 80, 1080),
      fontFamily,
      timerFontSize: integer(input.timerFontSize, this.defaults.timerFontSize, 12, 80),
      letterFontSize: integer(input.letterFontSize, this.defaults.letterFontSize, 12, 80),
      wordFontSize: integer(input.wordFontSize, this.defaults.wordFontSize, 10, 80),
      userFontSize: integer(input.userFontSize, this.defaults.userFontSize, 7, 32),
      theme,
      primaryColor: color(input.primaryColor, this.defaults.primaryColor),
      secondaryColor: color(input.secondaryColor, this.defaults.secondaryColor),
      backgroundColor: color(input.backgroundColor, this.defaults.backgroundColor),
      tileColor: color(input.tileColor, this.defaults.tileColor),
      textColor: color(input.textColor, this.defaults.textColor),
    };
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.settings, null, 2));
    fs.renameSync(temp, this.filePath);
  }
}
