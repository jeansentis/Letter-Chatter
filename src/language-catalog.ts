import fs from "node:fs";
import path from "node:path";
import { Dictionary, type GameDictionary } from "./dictionary.js";
import type { LanguageInfo } from "./types.js";

export interface LanguagePack {
  info: LanguageInfo;
  dictionary: Dictionary;
}

export interface LanguageSelection {
  dictionary: GameDictionary & { languagesFor(word: string): LanguageInfo[] };
  languages: LanguageInfo[];
}

export class LanguageCatalog {
  private readonly englishInfo: LanguageInfo = { id: "english", name: "English", flag: "🇬🇧" };
  private static english?: LanguagePack;
  private static readonly cache = new Map<string, { modified: number; pack: LanguagePack }>();

  private readonly directories: string[];

  constructor(directory: string | readonly string[]) {
    this.directories = Array.isArray(directory) ? [...directory] : [directory];
  }

  list(): LanguageInfo[] {
    return [this.englishInfo, ...this.files().map((file) => this.readInfo(file))]
      .sort((a, b) => a.id === "english" ? -1 : b.id === "english" ? 1 : a.name.localeCompare(b.name));
  }

  has(id: string): boolean {
    return id === "english" || this.files().some((file) => this.idFor(file) === id);
  }

  get(id: string): LanguagePack {
    if (id === "english") {
      const english = LanguageCatalog.english ?? { info: this.englishInfo, dictionary: new Dictionary() };
      LanguageCatalog.english = english;
      return english;
    }
    const file = this.files().find((candidate) => this.idFor(candidate) === id);
    return file ? this.load(file) : this.get("english");
  }

  getMany(ids: readonly string[]): LanguageSelection {
    const selectedIds = [...new Set(ids)].filter((id) => this.has(id));
    const packs = (selectedIds.length > 0 ? selectedIds : ["english"]).map((id) => this.get(id));
    return {
      dictionary: new MultilingualDictionary(packs),
      languages: packs.map((pack) => pack.info),
    };
  }

  private files(): string[] {
    const byId = new Map<string, string>();
    for (const directory of this.directories) {
      try {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".txt")) continue;
          const file = path.join(directory, entry.name);
          byId.set(this.idFor(file), file);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Could not scan language packs:", error);
      }
    }
    return [...byId.values()];
  }

  private idFor(file: string): string {
    return path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40);
  }

  private load(file: string): LanguagePack {
    const modified = fs.statSync(file).mtimeMs;
    const id = this.idFor(file);
    const cached = LanguageCatalog.cache.get(file);
    if (cached?.modified === modified) return cached.pack;

    const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
    const info = this.readInfo(file);
    const words: string[] = [];
    for (const line of lines) {
      if (!/^\s*(#|$)/.test(line)) words.push(line);
    }
    const dictionary = new Dictionary(words);
    if (dictionary.words.size === 0) throw new Error(`Language pack ${path.basename(file)} contains no valid words.`);
    const pack = { info, dictionary };
    LanguageCatalog.cache.set(file, { modified, pack });
    return pack;
  }

  private readInfo(file: string): LanguageInfo {
    const id = this.idFor(file);
    const buffer = Buffer.alloc(2048);
    const handle = fs.openSync(file, "r");
    let bytesRead = 0;
    try { bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0); }
    finally { fs.closeSync(handle); }
    const header = buffer.toString("utf8", 0, bytesRead).split(/\r?\n/);
    const nameLine = header.find((line) => /^\s*#\s*name\s*:/i.test(line));
    const flagLine = header.find((line) => /^\s*#\s*flag\s*:/i.test(line));
    const defaultName = id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const name = nameLine?.replace(/^\s*#\s*name\s*:\s*/i, "").trim() || defaultName;
    const flag = flagLine?.replace(/^\s*#\s*flag\s*:\s*/i, "").trim() || "🌐";
    return { id, name: name.slice(0, 40), flag: flag.slice(0, 8) };
  }
}

class MultilingualDictionary implements GameDictionary {
  constructor(private readonly packs: readonly LanguagePack[]) {}

  has(word: string): boolean {
    return this.packs.some((pack) => pack.dictionary.has(word));
  }

  languagesFor(word: string): LanguageInfo[] {
    return this.packs.filter((pack) => pack.dictionary.has(word)).map((pack) => pack.info);
  }

  randomSeed(maxLength: number, random = Math.random): string {
    const pack = this.packs[Math.floor(random() * this.packs.length)] ?? this.packs[0];
    return pack?.dictionary.randomSeed(maxLength, random) ?? "WORD";
  }

  randomLetter(random = Math.random, except?: string): string {
    const pack = this.packs[Math.floor(random() * this.packs.length)] ?? this.packs[0];
    return pack?.dictionary.randomLetter(random, except) ?? "E";
  }

  commonLetters(limit: number): string[] {
    const candidates = this.packs.map((pack) => pack.dictionary.commonLetters(limit));
    const result: string[] = [];
    for (let index = 0; result.length < limit && candidates.some((letters) => index < letters.length); index++) {
      for (const letters of candidates) {
        const letter = letters[index];
        if (letter && !result.includes(letter)) result.push(letter);
        if (result.length === limit) break;
      }
    }
    return result;
  }

  playableWords(rack: readonly string[]): Set<string> {
    const playable = new Set<string>();
    for (const pack of this.packs) {
      for (const word of pack.dictionary.playableWords(rack)) playable.add(word);
    }
    return playable;
  }
}
