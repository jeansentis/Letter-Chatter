const values = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10 };
const fonts = {
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  rounded: "'Trebuchet MS', 'Arial Rounded MT Bold', sans-serif",
  mono: "Consolas, 'Courier New', monospace",
  serif: "Georgia, 'Times New Roman', serif",
};
const flagAssets = {
  "🇬🇧": "/flags/gb.svg",
  "🇳🇱": "/flags/nl.svg",
  "🇩🇪": "/flags/de.svg",
  "🇪🇸": "/flags/es.svg",
  "🇫🇷": "/flags/fr.svg",
};
const play = document.querySelector("#play-view");
const results = document.querySelector("#results-view");
const setup = document.querySelector("#setup-view");
const countdown = document.querySelector("#countdown-view");
const seconds = document.querySelector("#seconds");
const letters = document.querySelector("#letters");
const guess = document.querySelector("#guess");
const guessLanguage = document.querySelector("#guess-language");
const scorePop = document.querySelector("#score-pop");
const rackCooldown = document.querySelector("#rack-cooldown");
const overlay = document.querySelector("#overlay");
const effects = document.querySelector("#effects");
let state;
let latestEvent = 0;
let lastShuffleId = 0;
let lastResultBoard = -1;
let perfectTimer;

function show(view) {
  for (const element of [play, countdown, results, setup]) element.classList.toggle("hidden", element !== view);
}

function applySettings(settings) {
  const style = document.documentElement.style;
  style.setProperty("--overlay-width", `${settings.overlayWidth}px`);
  style.setProperty("--overlay-height", `${settings.overlayHeight}px`);
  style.setProperty("--font-family", fonts[settings.fontFamily] ?? fonts.system);
  style.setProperty("--timer-font-size", `${settings.timerFontSize}px`);
  style.setProperty("--letter-font-size", `${settings.letterFontSize}px`);
  style.setProperty("--word-font-size", `${settings.wordFontSize}px`);
  style.setProperty("--user-font-size", `${settings.userFontSize}px`);
  style.setProperty("--primary", settings.primaryColor);
  style.setProperty("--secondary", settings.secondaryColor);
  style.setProperty("--panel", settings.backgroundColor);
  style.setProperty("--tile", settings.tileColor);
  style.setProperty("--text", settings.textColor);
}

function render(next) {
  state = next;
  applySettings(state.settings);
  const levelResult = state.phase === "results" && state.level;
  overlay.classList.toggle("result-win", Boolean(levelResult?.success));
  overlay.classList.toggle("result-loss", Boolean(levelResult && !levelResult.success));
  if (state.phase === "setup") { show(setup); return; }
  if (state.phase === "countdown") { show(countdown); renderCountdown(); return; }
  if (state.phase === "results") { show(results); renderResults(); return; }
  show(play);
  renderMode();
  const didShuffle = state.shuffleId !== lastShuffleId;
  renderRack(state.letters, didShuffle);
  renderGuessArea();
  if (state.latestGuess?.id > latestEvent) animateGuess(state.latestGuess);
  latestEvent = Math.max(latestEvent, state.latestGuess?.id ?? 0);
  lastShuffleId = state.shuffleId;
}

function renderGuessArea() {
  const event = state.latestGuess;
  if (!event) {
    setGuess("waiting", "guess idle", "<b>Waiting for a word...</b><span></span>", [], []);
    return;
  }
  const idleMs = Date.now() - event.at;
  if (idleMs >= 4000 && state.foundWords.length > 0) {
    const found = [...state.foundWords].reverse();
    const index = Math.floor((idleMs - 4000) / 1200) % found.length;
    const foundWord = found[index];
    setGuess(`reminder:${event.id}:${index}`, "guess reminder", `<b>${escapeHtml(foundWord.word)}</b><span>ALREADY FOUND</span>`, foundWord.languageFlags, foundWord.languageNames);
    return;
  }
  setGuess(
    `guess:${event.id}`,
    `guess ${event.duplicate ? "duplicate" : "correct"}`,
    `<b>${escapeHtml(event.word)}</b><span>${escapeHtml(event.username)}${event.duplicate ? " - already found" : ` - +${event.score}`}</span>`,
    event.languageFlags,
    event.languageNames,
  );
}

function setGuess(key, className, content, flags, names) {
  if (guess.dataset.key === key) return;
  guess.dataset.key = key;
  guess.className = className;
  guess.innerHTML = content;
  renderLanguageBadge(flags, names);
}

function renderLanguageBadge(flags = [], names = []) {
  const visibleFlags = flags.length > 0 ? flags : (state.languages ?? []).map((language) => language.flag);
  const visibleNames = names.length > 0 ? names : (state.languages ?? []).map((language) => language.name);
  const track = document.createElement("span");
  track.className = "flag-track";
  track.replaceChildren(...visibleFlags.map((flag, index) => {
    const asset = flagAssets[flag];
    if (!asset) {
      const fallback = document.createElement("span");
      fallback.className = "flag-fallback";
      fallback.textContent = flag;
      return fallback;
    }
    const image = document.createElement("img");
    image.src = asset;
    image.alt = `${visibleNames[index] ?? "Language"} flag`;
    return image;
  }));
  guessLanguage.replaceChildren(track);
  guessLanguage.title = visibleNames.join(" / ");
  guessLanguage.setAttribute("aria-label", visibleNames.join(" / "));
  guessLanguage.classList.toggle("hidden", visibleFlags.length === 0);
  guessLanguage.classList.remove("scrolling");
  requestAnimationFrame(() => guessLanguage.classList.toggle("scrolling", track.scrollWidth > guessLanguage.clientWidth - 12));
}

function renderMode() {
  const label = document.querySelector("#mode-label");
  const levelPoints = document.querySelector("#level-points");
  const levelRecord = document.querySelector("#level-record");
  const timer = document.querySelector(".timer");
  timer.classList.toggle("level-mode", Boolean(state.level));
  timer.classList.toggle("grace-mode", Boolean(state.gracePeriod));
  document.querySelector("#words-left").textContent = state.wordsRemaining;
  if (!state.level) {
    label.textContent = state.settings.mode === "time" ? `TIME +${state.settings.timeBonusSeconds}` : "RACE";
    levelPoints.classList.add("hidden");
    levelRecord.classList.add("hidden");
    return;
  }
  label.textContent = state.gracePeriod ? "GRACE" : `LEVEL ${state.level.number}`;
  levelRecord.textContent = `RECORD ${state.level.record}`;
  levelRecord.classList.remove("hidden");
  levelPoints.classList.remove("hidden");
  document.querySelector("#target-score").textContent = Math.max(0, state.level.target - state.level.score);
}

function renderCountdown() {
  const goal = document.querySelector("#countdown-goal");
  const message = document.querySelector("#countdown-message");
  if (state.level) {
    message.textContent = `Level ${state.level.number} - work together!`;
    goal.textContent = `${state.level.target} GOAL - ${state.wordsRemaining} WORDS - ${state.possiblePoints} POSSIBLE PTS`;
  } else if (state.settings.mode === "time") {
    message.textContent = `Every new word adds ${state.settings.timeBonusSeconds} seconds!`;
    goal.textContent = `${state.wordsRemaining} WORDS - ${state.possiblePoints} POSSIBLE PTS`;
  } else {
    message.textContent = "Guess words with the letters!";
    goal.textContent = `${state.wordsRemaining} WORDS - ${state.possiblePoints} POSSIBLE PTS`;
  }
}

function renderRack(rack, animate) {
  const oldPositions = new Map([...letters.children].map((tile) => [tile.dataset.key, tile.getBoundingClientRect()]));
  const occurrences = new Map();
  letters.innerHTML = rack.map((letter) => {
    const occurrence = occurrences.get(letter) ?? 0;
    occurrences.set(letter, occurrence + 1);
    return `<i class="letter" data-letter="${escapeAttribute(letter)}" data-key="${escapeAttribute(letter)}:${occurrence}">${escapeHtml(letter)}<small>${values[letter] ?? 1}</small></i>`;
  }).join("");
  if (!animate) return;
  requestAnimationFrame(() => {
    for (const tile of letters.children) {
      const old = oldPositions.get(tile.dataset.key);
      if (!old) {
        tile.animate([{ opacity: 0, transform: "scale(.4) rotate(-12deg)" }, { opacity: 1, transform: "scale(1)" }], { duration: 600, easing: "cubic-bezier(.2,.85,.25,1)" });
        continue;
      }
      const current = tile.getBoundingClientRect();
      const x = old.left - current.left;
      if (Math.abs(x) > 1) tile.animate([{ transform: `translateX(${x}px)` }, { transform: "translateX(0)" }], { duration: 650, easing: "cubic-bezier(.2,.85,.25,1)" });
    }
  });
}

function animateGuess(event) {
  if (event.duplicate) return;
  for (const tile of matchingTiles(event.word)) {
    tile.classList.add("used");
    if (event.perfect) tile.classList.add("perfect-used");
  }
  scorePop.textContent = event.perfect ? `ALL LETTERS! +${event.score}` : `+${event.score}`;
  scorePop.classList.toggle("perfect", event.perfect);
  scorePop.classList.remove("go");
  requestAnimationFrame(() => scorePop.classList.add("go"));
  if (event.perfect) celebratePerfect();
}

function matchingTiles(word) {
  const tiles = [...letters.children];
  const requirements = [...word]
    .map((letter, wordIndex) => ({ letter, wordIndex }))
    .sort((a, b) => Number(baseLetter(a.letter) === a.letter) - Number(baseLetter(b.letter) === b.letter));
  const used = new Set();
  const matches = [];
  for (const requirement of requirements) {
    let tile = tiles.find((candidate) => !used.has(candidate) && candidate.dataset.letter === requirement.letter);
    if (!tile && baseLetter(requirement.letter) === requirement.letter) {
      tile = tiles.find((candidate) => !used.has(candidate) && baseLetter(candidate.dataset.letter) === requirement.letter);
    }
    if (!tile) return [];
    used.add(tile);
    matches.push(tile);
  }
  return matches;
}

function baseLetter(letter) {
  return letter.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

function celebratePerfect() {
  clearTimeout(perfectTimer);
  overlay.classList.remove("perfect-hit");
  effects.replaceChildren();
  void overlay.offsetWidth;
  overlay.classList.add("perfect-hit");
  for (let index = 0; index < 22; index++) {
    const angle = Math.PI * 2 * index / 22 + Math.random() * .22;
    const distance = 55 + Math.random() * 95;
    const particle = document.createElement("i");
    particle.className = `burst-particle ${index % 4 === 0 ? "star" : ""}`;
    particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
    particle.style.setProperty("--spin", `${180 + Math.random() * 540}deg`);
    particle.style.setProperty("--delay", `${Math.random() * 90}ms`);
    effects.append(particle);
  }
  perfectTimer = setTimeout(() => {
    overlay.classList.remove("perfect-hit");
    effects.replaceChildren();
  }, 1450);
}

function renderResults() {
  const noWords = state.leaderboards.round.length === 0;
  const levelOutcome = state.level?.levelsCleared > 1
    ? `+${state.level.levelsCleared} LEVELS!`
    : "VICTORY!";
  const heading = state.level
    ? `<span class="result-kicker">LEVEL</span><strong class="result-level">${state.level.number}</strong><b class="result-outcome">${state.level.success ? levelOutcome : "DEFEAT"}</b><em class="result-record">RECORD ${state.level.record}</em>`
    : noWords ? "NO<br><b>WORDS</b>" : state.settings.mode === "time" ? "TIME<br><b>OVER</b>" : "ROUND<br><b>OVER</b>";
  document.querySelector("#round-ended").innerHTML = `${heading}<small id="next-round"></small>`;
  lastResultBoard = -1;
  renderResultBoard();
}

function renderResultBoard() {
  const boards = [["round", "This round"], ["stream", "This stream"], ["overall", "All time"]];
  const index = Math.floor((Date.now() - state.phaseStartedAt) / 3000) % boards.length;
  if (index === lastResultBoard) return;
  lastResultBoard = index;
  const [key, label] = boards[index];
  const rows = state.leaderboards[key];
  const content = rows.length ? rows.map((row, rank) => `<li><i>${rank + 1}</i><b>${escapeHtml(row.username)}</b><span>${row.score}</span></li>`).join("") : '<li class="empty"><b>No scores yet</b></li>';
  document.querySelector("#boards").innerHTML = `<div class="board"><h2>${label}</h2><ol>${content}</ol></div>`;
}

function tick() {
  if (!state || state.phase === "setup") return;
  const remainingMs = state.endsAt ? Math.max(0, state.endsAt - Date.now()) : 0;
  const left = Math.ceil(remainingMs / 1000);
  if (state.phase === "countdown") {
    document.querySelector("#countdown-seconds").textContent = left;
    return;
  }
  if (state.phase === "results") {
    renderResultBoard();
    const next = document.querySelector("#next-round");
    if (next) next.textContent = state.settings.autoContinue ? `NEXT ${left}s` : "MANUAL";
    return;
  }
  const rackRemainingMs = Math.max(0, state.rackChangeEndsAt - Date.now());
  renderGuessArea();
  const rackChanging = state.phase === "playing" && rackRemainingMs > 0;
  rackCooldown.classList.toggle("hidden", !rackChanging);
  if (rackChanging) {
    document.querySelector("#rack-cooldown-seconds").textContent = Math.ceil(rackRemainingMs / 1000);
    rackCooldown.style.setProperty("--cooldown", Math.max(0, Math.min(1, rackRemainingMs / (state.settings.guessCooldownSeconds * 1000))));
  }
  seconds.textContent = left;
  const timeSpanMs = state.gracePeriod ? 5000 : state.settings.roundSeconds * 1000;
  document.querySelector("#time-fill").style.width = `${Math.min(100, remainingMs / timeSpanMs * 100)}%`;
  document.querySelector(".timer")?.classList.toggle("urgent", left <= 10 && !state.gracePeriod);
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/live`);
  socket.onmessage = (message) => render(JSON.parse(message.data));
  socket.onclose = () => setTimeout(connect, 1500);
}

connect();
setInterval(tick, 200);
