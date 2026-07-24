import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDirectory = path.join(root, "data", "languages");
const licenseDirectory = path.join(outputDirectory, "licenses");
const repository = "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries";

const languages = [
  { id: "nl", name: "Nederlands", flag: "🇳🇱" },
  { id: "de", name: "Deutsch", flag: "🇩🇪" },
  { id: "fy", name: "Frysk", flag: "🇳🇱" },
  { id: "es", name: "Español", flag: "🇪🇸" },
  { id: "fr", name: "Français", flag: "🇫🇷" },
];

await fs.mkdir(licenseDirectory, { recursive: true });

for (const language of languages) {
  const base = `${repository}/${language.id}`;
  const [dictionary, license] = await Promise.all([
    download(`${base}/index.dic`),
    download(`${base}/license`),
  ]);
  const words = cleanHunspellDictionary(dictionary);
  const header = [
    `# name: ${language.name}`,
    `# flag: ${language.flag}`,
    `# source: https://github.com/wooorm/dictionaries/tree/main/dictionaries/${language.id}`,
    `# license: licenses/${language.id}.txt`,
    "",
  ];
  await fs.writeFile(path.join(outputDirectory, `${language.id}.txt`), `${header.join("\n")}${words.join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(licenseDirectory, `${language.id}.txt`), license, "utf8");
  console.log(`${language.id}: ${words.length.toLocaleString("en")} words`);
}

function cleanHunspellDictionary(input) {
  const words = new Set();
  for (const rawLine of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const entry = rawLine.trim().split(/\s+/u, 1)[0] ?? "";
    if (!entry || /^\d+$/u.test(entry)) continue;
    const flagIndex = entry.search(/(?<!\\)\//u);
    const rawWord = (flagIndex >= 0 ? entry.slice(0, flagIndex) : entry).replaceAll("\\/", "/");
    const word = rawWord.normalize("NFC").toLocaleUpperCase();
    if (/^\p{L}{3,15}$/u.test(word)) words.add(word);
  }
  return [...words].sort((a, b) => a.localeCompare(b));
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  return response.text();
}
