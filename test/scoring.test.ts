import assert from "node:assert/strict";
import test from "node:test";
import { Dictionary } from "../src/dictionary.js";
import { canBuildWord, normalizeWord, scoreWord } from "../src/scoring.js";

test("normalizes chat input", () => assert.equal(normalizeWord("  Cat  "), "CAT"));
test("uses each rack tile no more than once", () => {
  assert.equal(canBuildWord("LETTER", [..."LETTERS"]), true);
  assert.equal(canBuildWord("LETTER", [..."LETERS"]), false);
});
test("accented rack tiles can stand in for plain letters only", () => {
  assert.equal(canBuildWord("OSO", [..."ÓSO"]), true);
  assert.equal(canBuildWord("ÓSO", [..."OSO"]), false);
  assert.equal(canBuildWord("OÓ", [..."ÓO"]), true);

  const dictionary = new Dictionary(["OSO", "ÓSO"]);
  assert.deepEqual([...dictionary.playableWords([..."ÓSO"])].sort(), ["OSO", "ÓSO"].sort());
  assert.deepEqual([...dictionary.playableWords([..."OSO"])], ["OSO"]);
});
test("scores Scrabble values with the length bonus and rounds up", () => {
  assert.equal(scoreWord("CAT"), 7); // (3 + 1 + 1) × 1.3 = 6.5
  assert.equal(scoreWord("QUIZ"), 31); // 22 × 1.4 = 30.8
});
