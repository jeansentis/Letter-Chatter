export type Phase = "setup" | "countdown" | "playing" | "results";
export type GameMode = "race" | "level" | "time";
export type FontFamily = "system" | "rounded" | "mono" | "serif";
export type ThemeName = "candy" | "sunny" | "ocean" | "lime" | "midnight";

export interface LanguageInfo {
  id: string;
  name: string;
  flag: string;
}

export interface GameSettings {
  mode: GameMode;
  languages: string[];
  /** Kept only to migrate settings saved by versions that supported one language. */
  language?: string;
  roundSeconds: number;
  countdownSeconds: number;
  shuffleSeconds: number;
  timeBonusSeconds: number;
  guessCooldownSeconds: number;
  replaceUsedLetters: boolean;
  autoContinue: boolean;
  intermissionSeconds: number;
  minLetters: number;
  maxLetters: number;
  minimumWords: number;
  levelBaseGoal: number;
  levelGrowth: number;
  dynamicDifficulty: boolean;
  dynamicPointsPerPlayer: number;
  overlayWidth: number;
  overlayHeight: number;
  fontFamily: FontFamily;
  timerFontSize: number;
  letterFontSize: number;
  wordFontSize: number;
  userFontSize: number;
  theme: ThemeName;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  tileColor: string;
  textColor: string;
}

export interface LevelState {
  number: number;
  record: number;
  score: number;
  target: number;
  success: boolean;
  levelsCleared: number;
}

export interface PlayerScore {
  userId: string;
  username: string;
  score: number;
}

export interface GuessEvent {
  id: number;
  word: string;
  username: string;
  score: number;
  duplicate: boolean;
  perfect: boolean;
  languageFlags: string[];
  languageNames: string[];
  at: number;
}

export interface FoundWord {
  word: string;
  languageFlags: string[];
  languageNames: string[];
}

export interface PublicGameState {
  phase: Phase;
  round: number;
  letters: string[];
  endsAt: number;
  phaseStartedAt: number;
  shuffleId: number;
  wordsRemaining: number;
  possiblePoints: number;
  rackChangeEndsAt: number;
  gracePeriod: boolean;
  latestGuess: GuessEvent | null;
  guessedWords: string[];
  foundWords: FoundWord[];
  settings: GameSettings;
  languages: LanguageInfo[];
  level: LevelState | null;
  leaderboards: {
    round: PlayerScore[];
    stream: PlayerScore[];
    overall: PlayerScore[];
  };
  twitchConnected: boolean;
}

export interface StoredPlayer {
  username: string;
  score: number;
}

export interface ScoreFile {
  players: Record<string, StoredPlayer>;
  highestLevel?: number;
}
