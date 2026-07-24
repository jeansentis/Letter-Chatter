import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Dictionary } from "../src/dictionary.js";
import { Game } from "../src/game.js";
import { LanguageCatalog } from "../src/language-catalog.js";
import type { PlayerScore } from "../src/types.js";

const settings = {
  mode: "race" as const,
  languages: ["english"],
  roundSeconds: 999,
  countdownSeconds: 5,
  shuffleSeconds: 10,
  timeBonusSeconds: 5,
  guessCooldownSeconds: 5,
  replaceUsedLetters: false,
  autoContinue: false,
  intermissionSeconds: 30,
  minLetters: 7,
  maxLetters: 10,
  minimumWords: 25,
  levelBaseGoal: 100,
  levelGrowth: 1.35,
  dynamicDifficulty: false,
  dynamicPointsPerPlayer: 20,
  overlayWidth: 500,
  overlayHeight: 100,
  fontFamily: "system" as const,
  timerFontSize: 27,
  letterFontSize: 21,
  wordFontSize: 17,
  userFontSize: 8,
  theme: "candy" as const,
  primaryColor: "#ffcf4a",
  secondaryColor: "#ff5fa2",
  backgroundColor: "#35245f",
  tileColor: "#fff3bd",
  textColor: "#ffffff",
};

class MemoryStore {
  scores = new Map<string, PlayerScore>();
  levelRecord = 1;
  add(userId: string, username: string, score: number) {
    const old = this.scores.get(userId)?.score ?? 0;
    this.scores.set(userId, { userId, username, score: old + score });
  }
  top() { return [...this.scores.values()].sort((a, b) => b.score - a.score).slice(0, 3); }
  highestLevel() { return this.levelRecord; }
  recordLevel(level: number) { this.levelRecord = Math.max(this.levelRecord, level); }
}

test("accepts a valid first guess and shows later guesses as duplicates", () => {
  const store = new MemoryStore();
  const game = new Game(new Dictionary(["CAT", "ACT"]), store as any, settings);
  game.startRound([..."CATDOGS"], true);
  assert.equal(game.state().wordsRemaining, 2);
  assert.equal(game.state().possiblePoints, 14);
  const first = game.submit("1", "alice", "cat");
  const duplicate = game.submit("2", "bob", "CAT");
  assert.equal(first.accepted && first.event.score, 7);
  assert.equal(duplicate.accepted && duplicate.event.duplicate, true);
  assert.equal(game.state().wordsRemaining, 1);
  assert.equal(game.state().leaderboards.round[0]?.username, "alice");
  game.stop();
});

test("rejects dictionary words that cannot be made from the rack", () => {
  const game = new Game(new Dictionary(["CAT"]), new MemoryStore() as any, settings);
  game.startRound([..."DOGSXYZ"], true);
  assert.deepEqual(game.submit("1", "alice", "cat"), { accepted: false, reason: "not-in-rack" });
  game.stop();
});

test("level mode combines unique scores and advances after reaching the target", () => {
  const game = new Game(new Dictionary(["CAT", "ACT"]), new MemoryStore() as any, {
    ...settings,
    mode: "level",
    levelBaseGoal: 10,
  });
  game.startRound([..."CATDOGS"], true);
  game.submit("1", "alice", "CAT");
  game.submit("2", "bob", "ACT");
  assert.deepEqual(game.state().level, { number: 1, record: 2, score: 14, target: 10, success: true, levelsCleared: 1 });
  assert.equal(game.state().phase, "playing");
  game.startRound([..."CATDOGS"], true);
  assert.equal(game.state().level?.number, 2);
  assert.equal(game.state().level?.target, 14);
  game.endRound();
  assert.equal(game.state().level?.number, 2);
  game.startRound([..."CATDOGS"], true);
  assert.equal(game.state().level?.number, 1);
  game.stop();
});

test("extra Level points can clear several consecutive levels at once", () => {
  const store = new MemoryStore();
  const game = new Game(new Dictionary(["CAT", "ACT", "DOG"]), store as any, {
    ...settings,
    mode: "level",
    levelBaseGoal: 7,
    levelGrowth: 1,
  });
  try {
    game.startRound([..."CATDOGS"], true);
    game.submit("1", "alice", "CAT");
    game.submit("2", "bob", "ACT");
    game.submit("3", "carol", "DOG");
    assert.deepEqual(game.state().level, {
      number: 1,
      record: 4,
      score: 21,
      target: 7,
      success: true,
      levelsCleared: 3,
    });
    assert.equal(store.highestLevel(), 4);

    game.startRound([..."CATDOGS"], true);
    assert.equal(game.state().level?.number, 4);
    assert.equal(game.state().level?.record, 4);
  } finally {
    game.stop();
  }
});

test("level mode keeps accepting guesses during a five-second grace period", async () => {
  const game = new Game(new Dictionary(["CAT"]), new MemoryStore() as any, {
    ...settings,
    mode: "level",
    roundSeconds: 0.03,
  });
  try {
    game.startRound([..."CATDOGS"], true);
    await new Promise((resolve) => setTimeout(resolve, 45));
    const grace = game.state();
    assert.equal(grace.phase, "playing");
    assert.equal(grace.gracePeriod, true);
    assert.ok(grace.endsAt - Date.now() > 4500);
    assert.equal(game.submit("1", "alice", "CAT").accepted, true);
  } finally {
    game.stop();
  }
});

test("manual results stay open when auto-continue is disabled", () => {
  const game = new Game(new Dictionary(["CAT"]), new MemoryStore() as any, settings);
  game.startRound([..."CATDOGS"], true);
  game.endRound();
  assert.equal(game.state().phase, "results");
  assert.equal(game.state().endsAt, 0);
  game.stop();
});

test("an empty round shows results and automatically starts the next round", async () => {
  const game = new Game(new Dictionary(["CAT"]), new MemoryStore() as any, {
    ...settings,
    roundSeconds: 0.03,
    intermissionSeconds: 0.03,
    countdownSeconds: 0.03,
    autoContinue: true,
  });
  try {
    game.startRound([..."CATDOGS"], true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(game.state().phase, "results");
    assert.deepEqual(game.state().leaderboards.round, []);
    game.configure({ ...settings, roundSeconds: 999, intermissionSeconds: 0.03, countdownSeconds: 0.03, autoContinue: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(game.state().phase, "countdown");
    assert.equal(game.state().round, 2);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(game.state().phase, "playing");
  } finally {
    game.stop();
  }
});

test("the rack reshuffles while the guessed word remains readable", async () => {
  const game = new Game(new Dictionary(["CAT"]), new MemoryStore() as any, {
    ...settings,
    shuffleSeconds: 0.03,
    guessCooldownSeconds: 0.02,
    random: () => 0,
  });
  try {
    game.startRound([..."CATDOGS"], true);
    game.submit("1", "alice", "CAT");
    const before = game.state();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const after = game.state();
    assert.ok(after.shuffleId > before.shuffleId);
    assert.notDeepEqual(after.letters, before.letters);
    assert.equal(after.latestGuess?.word, "CAT");
  } finally {
    game.stop();
  }
});

test("time attack adds time for each unique valid word", () => {
  const game = new Game(new Dictionary(["CAT"]), new MemoryStore() as any, {
    ...settings,
    mode: "time",
    timeBonusSeconds: 5,
  });
  game.startRound([..."CATDOGS"], true);
  const originalEnd = game.state().endsAt;
  game.submit("1", "alice", "CAT");
  assert.equal(game.state().endsAt, originalEnd + 5000);
  game.submit("2", "bob", "CAT");
  assert.equal(game.state().endsAt, originalEnd + 5000);
  game.stop();
});

test("used rack letters are replaced only after the rack-change window", async () => {
  const game = new Game(new Dictionary(["CAT", "DOG"]), new MemoryStore() as any, {
    ...settings,
    replaceUsedLetters: true,
    guessCooldownSeconds: 0.04,
    random: () => 0.5,
  });
  try {
    game.startRound([..."CATDOGS"], true);
    const before = game.state();
    game.submit("1", "alice", "CAT");
    game.submit("2", "bob", "DOG");
    assert.ok(game.state().rackChangeEndsAt > Date.now());
    assert.equal(game.state().shuffleId, before.shuffleId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(game.state().shuffleId, before.shuffleId);
    await new Promise((resolve) => setTimeout(resolve, 35));
    const after = game.state();
    assert.ok(after.shuffleId > before.shuffleId);
    assert.equal(after.rackChangeEndsAt, 0);
    assert.notDeepEqual(after.letters, before.letters);
    assert.equal(after.letters.length, before.letters.length);
  } finally {
    game.stop();
  }
});

test("viewer cooldown blocks only that viewer", async () => {
  const game = new Game(new Dictionary(["CAT", "ACT", "DOG"]), new MemoryStore() as any, {
    ...settings,
    guessCooldownSeconds: 0.03,
  });
  try {
    game.startRound([..."CATDOGS"], true);
    assert.equal(game.submit("1", "alice", "CAT").accepted, true);
    const blocked = game.submit("1", "alice", "ACT");
    assert.equal(blocked.accepted, false);
    assert.equal(!blocked.accepted && blocked.reason, "cooldown");
    assert.equal(game.submit("2", "bob", "ACT").accepted, true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(game.submit("1", "alice", "DOG").accepted, true);
  } finally {
    game.stop();
  }
});

test("dynamic Level difficulty uses the previous round's player count and stays fixed", () => {
  const game = new Game(new Dictionary(["CAT", "ACT", "DOG"]), new MemoryStore() as any, {
    ...settings,
    mode: "level",
    dynamicDifficulty: true,
    dynamicPointsPerPlayer: 10,
    levelGrowth: 1,
  });
  try {
    game.startRound([..."CATDOGS"], true);
    assert.equal(game.state().level?.target, 10);
    game.submit("1", "alice", "CAT");
    assert.equal(game.state().level?.target, 10);
    game.submit("2", "bob", "ACT");
    assert.deepEqual(game.state().level, { number: 1, record: 2, score: 14, target: 10, success: true, levelsCleared: 1 });
    game.startRound([..."CATDOGS"], true);
    assert.deepEqual(game.state().level, { number: 2, record: 2, score: 0, target: 20, success: false, levelsCleared: 0 });
    game.submit("3", "carol", "DOG");
    assert.equal(game.state().level?.target, 20);
  } finally {
    game.stop();
  }
});

test("dynamic Level difficulty grows gently for larger chats", () => {
  const game = new Game(new Dictionary(["CAT", "ACT", "DOG", "GOD"]), new MemoryStore() as any, {
    ...settings,
    mode: "level",
    dynamicDifficulty: true,
    dynamicPointsPerPlayer: 10,
    levelGrowth: 1.35,
  });
  try {
    game.startRound([..."CATDOGS"], true);
    game.submit("1", "alice", "CAT");
    game.submit("2", "bob", "ACT");
    game.submit("3", "carol", "DOG");
    game.submit("4", "dave", "GOD");
    game.startRound([..."CATDOGS"], true);
    assert.equal(game.state().level?.number, 3);
    assert.equal(game.state().level?.target, 51); // ceil(10 × (1 + log2(4)) × (1 + .35 × 2))
    assert.equal(game.state().level?.record, 3);
  } finally {
    game.stop();
  }
});

test("supports accented words and reports the selected languages", () => {
  const game = new Game(new Dictionary(["ÉTÉ"]), new MemoryStore() as any, settings, { id: "fr", name: "Français", flag: "🇫🇷" });
  try {
    game.startRound([..."ÉTÉABCD"], true);
    const result = game.submit("1", "alice", "été");
    assert.equal(result.accepted, true);
    assert.deepEqual(game.state().languages, [{ id: "fr", name: "Français", flag: "🇫🇷" }]);
    assert.deepEqual(game.state().guessedWords, ["ÉTÉ"]);
    assert.deepEqual(result.accepted && result.event.languageFlags, ["🇫🇷"]);
  } finally {
    game.stop();
  }
});

test("combines selected dictionaries and reports every matching language", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "letter-chatter-languages-"));
  fs.writeFileSync(path.join(directory, "nl.txt"), "# name: Nederlands\n# flag: 🇳🇱\nKAT\nÉTÉ\n", "utf8");
  fs.writeFileSync(path.join(directory, "fr.txt"), "# name: Français\n# flag: 🇫🇷\nCHAT\nÉTÉ\n", "utf8");
  try {
    const selected = new LanguageCatalog(directory).getMany(["nl", "fr"]);
    const game = new Game(selected.dictionary, new MemoryStore() as any, { ...settings, languages: ["nl", "fr"] }, selected.languages);
    try {
      game.startRound([..."ÉTÉCHATK"], true);
      const shared = game.submit("1", "alice", "ÉTÉ");
      const french = game.submit("2", "bob", "CHAT");
      assert.deepEqual(shared.accepted && shared.event.languageFlags, ["🇳🇱", "🇫🇷"]);
      assert.deepEqual(french.accepted && french.event.languageFlags, ["🇫🇷"]);
      assert.deepEqual(game.state().foundWords.map((entry) => entry.word), ["ÉTÉ", "CHAT"]);
    } finally {
      game.stop();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("words shorter than three letters are rejected", () => {
  const game = new Game(new Dictionary(["AT", "CAT"]), new MemoryStore() as any, settings);
  game.startRound([..."CATDOGS"], true);
  assert.deepEqual(game.submit("1", "alice", "AT"), { accepted: false, reason: "not-a-word" });
  assert.equal(game.state().wordsRemaining, 1);
  game.stop();
});

test("using every rack tile marks a unique guess as perfect", () => {
  const game = new Game(new Dictionary(["CATDOGS"]), new MemoryStore() as any, settings);
  game.startRound([..."CATDOGS"], true);
  const result = game.submit("1", "alice", "CATDOGS");
  assert.equal(result.accepted && result.event.perfect, true);
  game.stop();
});

test("generated racks fall back to a rack that meets the minimum word count", () => {
  const words = [
    "AER", "AES", "AET", "ARS", "ART", "AST", "ERS", "ERT", "EST", "RST",
    "ERA", "EAR", "ARE", "SEA", "EAT", "TEA", "SAT", "TAR", "RAT", "STAR",
    "AERS", "AERT", "AEST", "ARST", "ERST",
  ];
  const game = new Game(new Dictionary(words), new MemoryStore() as any, {
    ...settings,
    minLetters: 5,
    maxLetters: 5,
    minimumWords: 25,
    random: () => 0,
  });
  game.startRound();
  assert.equal(game.state().wordsRemaining, 25);
  assert.deepEqual([...game.state().letters].sort(), [..."AERST"]);
  game.stop();
});
