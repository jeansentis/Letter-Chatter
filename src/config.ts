import "dotenv/config";
import type { GameSettings } from "./types.js";

const integer = (name: string, fallback: number) => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: integer("PORT", 1010),
  sessionSecret: process.env.SESSION_SECRET ?? "",
  game: {
    mode: "level",
    languages: ["english"],
    roundSeconds: Math.max(10, integer("ROUND_SECONDS", 90)),
    countdownSeconds: 5,
    shuffleSeconds: 10,
    timeBonusSeconds: 5,
    guessCooldownSeconds: 5,
    replaceUsedLetters: false,
    autoContinue: true,
    intermissionSeconds: Math.max(3, integer("RESULTS_SECONDS", 30)),
    minLetters: Math.max(5, integer("MIN_LETTERS", 7)),
    maxLetters: Math.max(5, integer("MAX_LETTERS", 10)),
    minimumWords: 25,
    levelBaseGoal: 500,
    levelGrowth: 1.35,
    dynamicDifficulty: false,
    dynamicPointsPerPlayer: 20,
    overlayWidth: 600,
    overlayHeight: 150,
    fontFamily: "system",
    timerFontSize: 27,
    letterFontSize: 27,
    wordFontSize: 27,
    userFontSize: 8,
    theme: "candy",
    primaryColor: "#ffcf4a",
    secondaryColor: "#ff5fa2",
    backgroundColor: "#35245f",
    tileColor: "#fff3bd",
    textColor: "#ffffff",
  } satisfies GameSettings,
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID ?? "",
    clientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
    redirectUri: process.env.TWITCH_REDIRECT_URI ?? "http://localhost:1010/auth/twitch/callback",
  },
};
