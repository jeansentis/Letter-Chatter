import { EventEmitter } from "node:events";
import type { GameDictionary } from "./dictionary.js";
import { ScoreStore } from "./score-store.js";
import { canBuildWord, matchingRackIndices, normalizeWord, scoreWord } from "./scoring.js";
import type { GameSettings, GuessEvent, LanguageInfo, LevelState, PlayerScore, PublicGameState } from "./types.js";

const LEVEL_GRACE_MS = 5000;

export interface GameOptions extends GameSettings {
  random?: () => number;
}

export type GuessResult =
  | { accepted: true; event: GuessEvent }
  | { accepted: false; reason: "not-playing" | "not-a-word" | "not-in-rack" }
  | { accepted: false; reason: "cooldown"; retryAfterMs: number };

export class Game extends EventEmitter {
  private phase: "setup" | "countdown" | "playing" | "results" = "setup";
  private round = 0;
  private letters: string[] = [];
  private endsAt = 0;
  private phaseStartedAt = 0;
  private shuffleId = 0;
  private eventId = 0;
  private latestGuess: GuessEvent | null = null;
  private guessed = new Set<string>();
  private guessedLanguages = new Map<string, LanguageInfo[]>();
  private possibleWords = new Set<string>();
  private possiblePointTotal = 0;
  private roundScores = new Map<string, PlayerScore>();
  private streamScores = new Map<string, PlayerScore>();
  private userCooldowns = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private shuffleTimer?: NodeJS.Timeout;
  private postGuessTimer?: NodeJS.Timeout;
  private rackChangeEndsAt = 0;
  private gracePeriod = false;
  private pendingReplacementWords = new Set<string>();
  private levelNumber = 1;
  private levelScore = 0;
  private levelSuccess = false;
  private levelRoundTarget = 0;
  private levelRoundPlayerCount = 1;
  private levelsToAdvance = 0;
  private resetLevelNext = false;
  twitchConnected = false;

  constructor(
    private dictionary: GameDictionary & { languagesFor?(word: string): LanguageInfo[] },
    private readonly store: ScoreStore,
    private options: GameOptions,
    language: LanguageInfo | LanguageInfo[] = { id: "english", name: "English", flag: "🇬🇧" },
  ) {
    super();
    this.languages = Array.isArray(language) ? language : [language];
  }

  private languages: LanguageInfo[];

  start(): void {
    if (this.phase !== "setup") return;
    this.startRound();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.shuffleTimer) clearInterval(this.shuffleTimer);
    if (this.postGuessTimer) clearTimeout(this.postGuessTimer);
  }

  enterSetup(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.shuffleTimer) clearInterval(this.shuffleTimer);
    if (this.postGuessTimer) clearTimeout(this.postGuessTimer);
    this.rackChangeEndsAt = 0;
    this.gracePeriod = false;
    this.pendingReplacementWords.clear();
    this.userCooldowns.clear();
    this.phase = "setup";
    this.letters = [];
    this.possibleWords.clear();
    this.guessed.clear();
    this.guessedLanguages.clear();
    this.possiblePointTotal = 0;
    this.latestGuess = null;
    this.endsAt = 0;
    this.phaseStartedAt = 0;
    this.changed();
  }

  configure(settings: GameSettings, restartRound = false): void {
    const modeChanged = settings.mode !== this.options.mode;
    this.options = { ...this.options, ...settings };
    if (modeChanged) {
      this.levelNumber = 1;
      this.levelRoundPlayerCount = 1;
      this.levelsToAdvance = 0;
      this.resetLevelNext = false;
    }
    if (restartRound && this.phase !== "setup") this.startRound();
    else this.changed();
  }

  setDictionary(dictionary: GameDictionary & { languagesFor?(word: string): LanguageInfo[] }, languages: LanguageInfo[]): void {
    this.dictionary = dictionary;
    this.languages = languages;
  }

  submit(userId: string, username: string, input: string): GuessResult {
    if (this.phase !== "playing") return { accepted: false, reason: "not-playing" };
    const word = normalizeWord(input);
    if (!/^\p{L}{3,15}$/u.test(word) || !this.dictionary.has(word)) {
      return { accepted: false, reason: "not-a-word" };
    }
    if (!canBuildWord(word, this.letters)) return { accepted: false, reason: "not-in-rack" };

    const now = Date.now();
    const cooldownEndsAt = this.userCooldowns.get(userId) ?? 0;
    if (cooldownEndsAt > now) {
      return { accepted: false, reason: "cooldown", retryAfterMs: cooldownEndsAt - now };
    }
    this.userCooldowns.set(userId, now + this.options.guessCooldownSeconds * 1000);

    const duplicate = this.guessed.has(word);
    const score = duplicate ? 0 : scoreWord(word);
    const wordLanguages = this.matchingLanguages(word);
    this.guessed.add(word);
    this.guessedLanguages.set(word, wordLanguages);
    if (score > 0) {
      this.addScore(this.roundScores, userId, username, score);
      this.addScore(this.streamScores, userId, username, score);
      this.store.add(userId, username, score);
      if (this.options.mode === "time") this.extendRound(this.options.timeBonusSeconds);
      this.pendingReplacementWords.add(word);
      this.startRackChangeWindow();
    }
    const event = {
      id: ++this.eventId,
      word,
      username,
      score,
      duplicate,
      perfect: !duplicate && [...word].length === this.letters.length,
      languageFlags: [...new Set(wordLanguages.map((language) => language.flag))],
      languageNames: wordLanguages.map((language) => language.name),
      at: Date.now(),
    };
    this.latestGuess = event;
    if (this.options.mode === "level" && score > 0) {
      this.levelScore += score;
      const levelsCleared = this.clearedLevelCount();
      if (levelsCleared > this.levelsToAdvance) {
        this.levelsToAdvance = levelsCleared;
        this.store.recordLevel(this.levelNumber + levelsCleared);
      }
      this.levelSuccess = levelsCleared > 0;
    }
    this.changed();
    return { accepted: true, event };
  }

  endRound(): void {
    if (this.phase !== "playing") return;
    if (this.timer) clearTimeout(this.timer);
    if (this.shuffleTimer) clearInterval(this.shuffleTimer);
    if (this.postGuessTimer) clearTimeout(this.postGuessTimer);
    this.rackChangeEndsAt = 0;
    this.gracePeriod = false;
    this.pendingReplacementWords.clear();
    this.userCooldowns.clear();
    this.phase = "results";
    if (this.options.mode === "level" && !this.levelSuccess) this.resetLevelNext = true;
    this.phaseStartedAt = Date.now();
    this.endsAt = this.options.autoContinue ? Date.now() + this.options.intermissionSeconds * 1000 : 0;
    this.latestGuess = null;
    this.changed();
    if (this.options.autoContinue) {
      this.timer = setTimeout(() => this.startRound(), this.options.intermissionSeconds * 1000);
    }
  }

  startRound(forcedLetters?: string[], skipCountdown = false): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.shuffleTimer) clearInterval(this.shuffleTimer);
    if (this.postGuessTimer) clearTimeout(this.postGuessTimer);
    this.rackChangeEndsAt = 0;
    this.gracePeriod = false;
    this.pendingReplacementWords.clear();
    this.userCooldowns.clear();
    const previousRoundPlayers = Math.max(1, this.roundScores.size);
    if (this.options.mode === "level") {
      if (this.resetLevelNext) {
        this.levelNumber = 1;
        this.resetLevelNext = false;
        this.levelsToAdvance = 0;
      } else if (this.levelsToAdvance > 0) {
        this.levelNumber += this.levelsToAdvance;
        this.levelsToAdvance = 0;
      }
      this.store.recordLevel(this.levelNumber);
      this.levelRoundPlayerCount = previousRoundPlayers;
      this.levelRoundTarget = this.calculateLevelTarget(previousRoundPlayers, this.levelNumber);
    } else {
      this.levelRoundTarget = 0;
      this.levelRoundPlayerCount = 1;
    }
    this.round += 1;
    if (forcedLetters) {
      this.letters = forcedLetters;
      this.possibleWords = this.dictionary.playableWords(this.letters);
    } else {
      const rack = this.selectRack();
      this.letters = rack.letters;
      this.possibleWords = rack.words;
    }
    this.possiblePointTotal = this.scorePossibilities(this.possibleWords);
    this.guessed.clear();
    this.guessedLanguages.clear();
    this.roundScores.clear();
    this.latestGuess = null;
    this.levelScore = 0;
    this.levelSuccess = false;
    this.phaseStartedAt = Date.now();
    if (skipCountdown) {
      this.phase = "playing";
      this.activateRound();
    } else {
      this.phase = "countdown";
      this.endsAt = this.phaseStartedAt + this.options.countdownSeconds * 1000;
      this.changed();
      this.timer = setTimeout(() => this.activateRound(), this.options.countdownSeconds * 1000);
    }
  }

  state(): PublicGameState {
    return {
      phase: this.phase,
      round: this.round,
      letters: [...this.letters],
      endsAt: this.endsAt,
      phaseStartedAt: this.phaseStartedAt,
      shuffleId: this.shuffleId,
      wordsRemaining: this.wordsRemaining(),
      possiblePoints: this.possiblePointTotal,
      rackChangeEndsAt: this.rackChangeEndsAt,
      gracePeriod: this.gracePeriod,
      latestGuess: this.latestGuess,
      guessedWords: [...this.guessed],
      foundWords: [...this.guessed].map((word) => {
        const wordLanguages = this.guessedLanguages.get(word) ?? this.languages;
        return {
          word,
          languageFlags: [...new Set(wordLanguages.map((language) => language.flag))],
          languageNames: wordLanguages.map((language) => language.name),
        };
      }),
      settings: this.publicSettings(),
      languages: [...this.languages],
      level: this.levelState(),
      leaderboards: {
        round: this.top(this.roundScores),
        stream: this.top(this.streamScores),
        overall: this.store.top(),
      },
      twitchConnected: this.twitchConnected,
    };
  }

  private activateRound(): void {
    if (this.timer) clearTimeout(this.timer);
    this.phase = "playing";
    this.gracePeriod = false;
    this.phaseStartedAt = Date.now();
    this.endsAt = this.phaseStartedAt + this.options.roundSeconds * 1000;
    this.changed();
    this.scheduleRoundEnd();
    this.resetShuffleTimer();
  }

  private shuffleRack(): void {
    if (this.phase !== "playing") return;
    this.letters = this.shuffled(this.letters);
    this.shuffleId += 1;
    this.changed();
  }

  private startRackChangeWindow(): void {
    if (this.rackChangeEndsAt > Date.now()) return;
    if (this.shuffleTimer) clearInterval(this.shuffleTimer);
    this.rackChangeEndsAt = Date.now() + this.options.guessCooldownSeconds * 1000;
    this.postGuessTimer = setTimeout(() => this.finishGuessWindow(), this.options.guessCooldownSeconds * 1000);
  }

  private finishGuessWindow(): void {
    if (this.phase !== "playing") return;
    if (this.options.replaceUsedLetters) {
      const used = new Set<number>();
      for (const word of this.pendingReplacementWords) {
        for (const index of matchingRackIndices(word, this.letters) ?? []) used.add(index);
      }
      let best = { letters: [...this.letters], words: new Set<string>(), points: 0 };
      for (let attempt = 0; attempt < 24; attempt++) {
        const letters = [...this.letters];
        for (const index of used) letters[index] = this.randomLetter(letters[index]);
        const candidate = this.evaluateRack(letters);
        if (candidate.words.size > best.words.size || candidate.words.size === best.words.size && candidate.points > best.points) best = candidate;
        if (candidate.words.size >= this.options.minimumWords) break;
      }
      if (best.words.size < this.options.minimumWords) {
        best = this.selectRack(this.letters.length);
      }
      this.letters = best.letters;
      this.possibleWords = best.words;
      this.possiblePointTotal = best.points;
    }
    this.pendingReplacementWords.clear();
    this.rackChangeEndsAt = 0;
    this.postGuessTimer = undefined;
    this.letters = this.shuffled(this.letters);
    this.shuffleId += 1;
    this.changed();
    this.resetShuffleTimer();
  }

  private extendRound(seconds: number): void {
    this.endsAt += seconds * 1000;
    this.scheduleRoundEnd();
  }

  private scheduleRoundEnd(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.handleRoundTimer(), Math.max(0, this.endsAt - Date.now()));
  }

  private handleRoundTimer(): void {
    if (this.phase !== "playing") return;
    if (this.options.mode === "level" && !this.gracePeriod) {
      this.gracePeriod = true;
      this.endsAt = Date.now() + LEVEL_GRACE_MS;
      this.changed();
      this.scheduleRoundEnd();
      return;
    }
    this.endRound();
  }

  private resetShuffleTimer(): void {
    if (this.shuffleTimer) clearInterval(this.shuffleTimer);
    if (this.phase === "playing") {
      this.shuffleTimer = setInterval(() => this.shuffleRack(), this.options.shuffleSeconds * 1000);
    }
  }

  private shuffled(input: readonly string[]): string[] {
    const random = this.options.random ?? Math.random;
    const result = [...input];
    for (let index = result.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [result[index], result[swap]] = [result[swap]!, result[index]!];
    }
    if (result.length > 1 && result.every((value, index) => value === input[index])) {
      result.push(result.shift()!);
    }
    return result;
  }

  private levelTarget(): number {
    return this.levelRoundTarget || this.calculateLevelTarget(1);
  }

  private calculateLevelTarget(playerCount: number, levelNumber = this.levelNumber): number {
    const base = this.options.dynamicDifficulty
      ? this.options.dynamicPointsPerPlayer * (1 + Math.log2(Math.max(1, playerCount)))
      : this.options.levelBaseGoal;
    const growth = this.options.dynamicDifficulty
      ? 1 + (this.options.levelGrowth - 1) * (levelNumber - 1)
      : Math.pow(this.options.levelGrowth, levelNumber - 1);
    const target = base * growth;
    return Math.ceil(target - Number.EPSILON * Math.max(1, Math.abs(target)));
  }

  private clearedLevelCount(): number {
    let scoreLeft = this.levelScore;
    let levelsCleared = 0;
    while (true) {
      const level = this.levelNumber + levelsCleared;
      const target = levelsCleared === 0
        ? this.levelTarget()
        : this.calculateLevelTarget(this.levelRoundPlayerCount, level);
      if (scoreLeft < target) return levelsCleared;
      scoreLeft -= target;
      levelsCleared += 1;
    }
  }

  private levelState(): LevelState | null {
    if (this.options.mode !== "level") return null;
    return {
      number: this.levelNumber,
      record: Math.max(this.levelNumber, this.store.highestLevel()),
      score: this.levelScore,
      target: this.levelTarget(),
      success: this.levelSuccess,
      levelsCleared: this.levelsToAdvance,
    };
  }

  private publicSettings(): GameSettings {
    const { random: _random, ...settings } = this.options;
    return settings;
  }

  private selectRack(fixedLength?: number): { letters: string[]; words: Set<string>; points: number } {
    const random = this.options.random ?? Math.random;
    const min = Math.min(this.options.minLetters, this.options.maxLetters);
    const max = Math.max(this.options.minLetters, this.options.maxLetters);
    const firstLength = fixedLength ?? min + Math.floor(random() * (max - min + 1));
    const lengths = fixedLength ? [fixedLength] : [
      ...Array.from({ length: max - firstLength + 1 }, (_, index) => firstLength + index),
      ...Array.from({ length: firstLength - min }, (_, index) => min + index),
    ];
    let best = { letters: [] as string[], words: new Set<string>(), points: 0 };
    for (const length of lengths) {
      const attempts = Math.max(6, Math.min(12, 16 - length));
      for (let attempt = 0; attempt < attempts; attempt++) {
        const candidate = this.evaluateRack(this.generateRack(length));
        if (candidate.words.size > best.words.size || candidate.words.size === best.words.size && candidate.points > best.points) best = candidate;
        if (candidate.words.size >= this.options.minimumWords) return candidate;
      }
      const fallback = this.evaluateRack(this.fallbackRack(length));
      if (fallback.words.size > best.words.size || fallback.words.size === best.words.size && fallback.points > best.points) best = fallback;
      if (fallback.words.size >= this.options.minimumWords) return fallback;
    }
    return best;
  }

  private evaluateRack(letters: string[]): { letters: string[]; words: Set<string>; points: number } {
    const words = this.dictionary.playableWords(letters);
    return { letters, words, points: this.scorePossibilities(words) };
  }

  private fallbackRack(length: number): string[] {
    const fallbacks: Record<number, string> = {
      5: "AERST", 6: "AEIRST", 7: "AEINRST", 8: "AEILNRST", 9: "ACEILNRST", 10: "ACEILNORST",
    };
    const english = fallbacks[length] ?? "ACEILNORSTUDGMPHBYFVKWXQJZ".slice(0, length);
    if (this.dictionary.playableWords([...english]).size > 0) return this.shuffled([...english]);
    const seed = [...this.dictionary.randomSeed(length, this.options.random ?? Math.random)];
    const common = this.dictionary.commonLetters(length);
    const letters = seed.slice(0, length);
    while (letters.length < length) letters.push(common[letters.length % common.length] ?? "E");
    return this.shuffled(letters);
  }

  private generateRack(length: number): string[] {
    const random = this.options.random ?? Math.random;
    const seed = this.dictionary.randomSeed(Math.min(8, length), random);
    const letters = [...seed];
    while (letters.length < length) letters.push(this.dictionary.randomLetter(random));
    for (let index = letters.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [letters[index], letters[swap]] = [letters[swap]!, letters[index]!];
    }
    return letters;
  }

  private randomLetter(except?: string): string {
    const random = this.options.random ?? Math.random;
    return this.dictionary.randomLetter(random, except);
  }

  private wordsRemaining(): number {
    let count = 0;
    for (const word of this.possibleWords) if (!this.guessed.has(word)) count += 1;
    return count;
  }

  private scorePossibilities(words: Iterable<string>): number {
    let total = 0;
    for (const word of words) total += scoreWord(word);
    return total;
  }

  private matchingLanguages(word: string): LanguageInfo[] {
    const matches = this.dictionary.languagesFor?.(word) ?? [];
    return matches.length > 0 ? matches : this.languages;
  }

  private addScore(map: Map<string, PlayerScore>, userId: string, username: string, score: number): void {
    const current = map.get(userId) ?? { userId, username, score: 0 };
    map.set(userId, { userId, username, score: current.score + score });
  }

  private top(map: Map<string, PlayerScore>): PlayerScore[] {
    return [...map.values()]
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
      .slice(0, 3);
  }

  private changed(): void {
    this.emit("change", this.state());
  }
}
