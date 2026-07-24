import fs from "node:fs";
import wordListPath from "word-list";
import { canBuildWord } from "./scoring.js";

export interface GameDictionary {
  has(word: string): boolean;
  randomSeed(maxLength: number, random?: () => number): string;
  randomLetter(random?: () => number, except?: string): string;
  commonLetters(limit: number): string[];
  playableWords(rack: readonly string[]): Set<string>;
}

export class Dictionary implements GameDictionary {
  readonly words: Set<string>;
  readonly rackSeeds: string[];
  private readonly wordsByLength = new Map<number, string[]>();
  private readonly letterFrequency = new Map<string, number>();
  private letterBag: string[] = [];

  constructor(source?: Iterable<string>) {
    const input = source ?? fs.readFileSync(wordListPath, "utf8").split(/\r?\n/);
    this.words = new Set<string>();
    this.rackSeeds = [];
    for (const raw of input) {
      const word = raw.trim().normalize("NFC").toLocaleUpperCase();
      if (!/^\p{L}{3,15}$/u.test(word)) continue;
      const letters = [...word];
      this.words.add(word);
      const wordsOfLength = this.wordsByLength.get(letters.length) ?? [];
      wordsOfLength.push(word);
      this.wordsByLength.set(letters.length, wordsOfLength);
      if (letters.length >= 3 && letters.length <= 8) this.rackSeeds.push(word);
      for (const letter of letters) this.letterFrequency.set(letter, (this.letterFrequency.get(letter) ?? 0) + 1);
    }
    this.buildLetterBag();
  }

  has(word: string): boolean {
    return this.words.has(word);
  }

  randomSeed(maxLength: number, random = Math.random): string {
    const candidates = this.rackSeeds.filter((word) => [...word].length <= maxLength);
    return candidates[Math.floor(random() * candidates.length)] ?? "WORD";
  }

  randomLetter(random = Math.random, except?: string): string {
    let letter = except;
    for (let attempt = 0; attempt < 6 && letter === except; attempt++) {
      letter = this.letterBag[Math.floor(random() * this.letterBag.length)];
    }
    return letter && letter !== except ? letter : this.commonLetters(2).find((value) => value !== except) ?? "E";
  }

  commonLetters(limit: number): string[] {
    return [...this.letterFrequency.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([letter]) => letter);
  }

  playableWords(rack: readonly string[]): Set<string> {
    const playable = new Set<string>();
    for (let length = 3; length <= rack.length; length++) {
      for (const word of this.wordsByLength.get(length) ?? []) {
        if (canBuildWord(word, rack)) playable.add(word);
      }
    }
    return playable;
  }

  private buildLetterBag(): void {
    const largest = Math.max(1, ...this.letterFrequency.values());
    for (const [letter, count] of this.letterFrequency) {
      const weight = Math.max(1, Math.round(count / largest * 24));
      for (let index = 0; index < weight; index++) this.letterBag.push(letter);
    }
    if (this.letterBag.length === 0) this.letterBag = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  }
}
