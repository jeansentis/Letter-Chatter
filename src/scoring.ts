export const LETTER_VALUES: Readonly<Record<string, number>> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1,
  J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1,
  S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

const baseLetterCache = new Map<string, string>();

export function normalizeWord(input: string): string {
  return input.trim().normalize("NFC").toLocaleUpperCase();
}

export function baseLetter(letter: string): string {
  const cached = baseLetterCache.get(letter);
  if (cached) return cached;
  const base = letter.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  baseLetterCache.set(letter, base);
  return base;
}

export function matchingRackIndices(word: string, rack: readonly string[]): number[] | null {
  const requirements = [...word]
    .map((letter, wordIndex) => ({ letter, wordIndex }))
    // Accented requirements must claim their exact tile before plain letters use flexible accented tiles.
    .sort((a, b) => Number(baseLetter(a.letter) === a.letter) - Number(baseLetter(b.letter) === b.letter));
  const used = new Set<number>();
  const result = Array<number>(requirements.length);
  for (const requirement of requirements) {
    let rackIndex = rack.findIndex((letter, index) => !used.has(index) && letter === requirement.letter);
    if (rackIndex < 0 && baseLetter(requirement.letter) === requirement.letter) {
      rackIndex = rack.findIndex((letter, index) => !used.has(index) && baseLetter(letter) === requirement.letter);
    }
    if (rackIndex < 0) return null;
    used.add(rackIndex);
    result[requirement.wordIndex] = rackIndex;
  }
  return result;
}

export function canBuildWord(word: string, rack: readonly string[]): boolean {
  return [...word].length > 0 && matchingRackIndices(word, rack) !== null;
}

export function scoreWord(word: string): number {
  const letters = [...word];
  const base = letters.reduce((sum, letter) => sum + (LETTER_VALUES[letter] ?? 1), 0);
  return Math.ceil(base * (1 + letters.length / 10));
}
