import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ScoreStore } from "../src/score-store.js";

test("the highest Level record persists and never decreases", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stream-letters-scores-"));
  const file = path.join(directory, "scores.json");
  try {
    const store = new ScoreStore(file);
    assert.equal(store.highestLevel(), 1);

    store.recordLevel(7);
    store.recordLevel(3);

    const reloaded = new ScoreStore(file);
    assert.equal(reloaded.highestLevel(), 7);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).highestLevel, 7);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
