const values = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10 };
const fonts = {
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  rounded: "'Trebuchet MS', 'Arial Rounded MT Bold', sans-serif",
  mono: "Consolas, 'Courier New', monospace",
  serif: "Georgia, 'Times New Roman', serif",
};
const letters = document.querySelector("#letters");
let state;
let latestEvent = 0;
let lastShuffleId = 0;
let exitAnimation;

function applySettings(settings) {
  const style = document.documentElement.style;
  style.setProperty("--overlay-width", `${settings.overlayWidth}px`);
  style.setProperty("--overlay-height", `${settings.overlayHeight}px`);
  style.setProperty("--font-family", fonts[settings.fontFamily] ?? fonts.system);
  style.setProperty("--letter-font-size", `${settings.letterFontSize}px`);
  style.setProperty("--primary", settings.primaryColor);
  style.setProperty("--secondary", settings.secondaryColor);
  style.setProperty("--panel", settings.backgroundColor);
  style.setProperty("--tile", settings.tileColor);
}

function render(next) {
  const previousPhase = state?.phase;
  state = next;
  applySettings(state.settings);

  if (state.phase === "playing") {
    if (exitAnimation) {
      clearTimeout(exitAnimation);
      exitAnimation = undefined;
    }
    const entering = previousPhase !== "playing" || letters.children.length === 0;
    const shuffled = !entering && state.shuffleId !== lastShuffleId;
    renderRack(state.letters, entering ? "enter" : shuffled ? "shuffle" : "none");
    if (state.latestGuess?.id > latestEvent) animateGuess(state.latestGuess);
    latestEvent = Math.max(latestEvent, state.latestGuess?.id ?? 0);
    lastShuffleId = state.shuffleId;
    return;
  }

  if (previousPhase === "playing" && letters.children.length > 0) animateOut();
  else if (!state || state.phase === "setup") letters.replaceChildren();
  latestEvent = Math.max(latestEvent, state.latestGuess?.id ?? 0);
}

function renderRack(rack, animation) {
  const oldPositions = new Map([...letters.children].map((tile) => [tile.dataset.key, tile.getBoundingClientRect()]));
  const occurrences = new Map();
  letters.innerHTML = rack.map((letter) => {
    const occurrence = occurrences.get(letter) ?? 0;
    occurrences.set(letter, occurrence + 1);
    return `<i class="letter" data-letter="${escapeAttribute(letter)}" data-key="${escapeAttribute(letter)}:${occurrence}">${escapeHtml(letter)}<small>${values[letter] ?? 1}</small></i>`;
  }).join("");
  if (animation === "none") return;

  requestAnimationFrame(() => {
    [...letters.children].forEach((tile, index) => {
      if (animation === "enter") {
        tile.animate(
          [{ opacity: 0, transform: "translateY(-120%) scale(.35) rotate(-16deg)" }, { opacity: 1, transform: "translateY(0) scale(1) rotate(0)" }],
          { duration: 520, delay: index * 115, easing: "cubic-bezier(.18,.9,.25,1)", fill: "backwards" },
        );
        return;
      }
      const old = oldPositions.get(tile.dataset.key);
      if (!old) {
        tile.animate(
          [{ opacity: 0, transform: "translateY(-80%) scale(.4) rotate(-12deg)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
          { duration: 520, delay: index * 65, easing: "cubic-bezier(.2,.85,.25,1)", fill: "backwards" },
        );
        return;
      }
      const current = tile.getBoundingClientRect();
      const x = old.left - current.left;
      if (Math.abs(x) > 1) {
        tile.animate([{ transform: `translateX(${x}px)` }, { transform: "translateX(0)" }], { duration: 650, easing: "cubic-bezier(.2,.85,.25,1)" });
      }
    });
  });
}

function animateOut() {
  const tiles = [...letters.children];
  tiles.reverse().forEach((tile, index) => {
    tile.animate(
      [{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(120%) scale(.35) rotate(16deg)" }],
      { duration: 420, delay: index * 100, easing: "cubic-bezier(.55,.05,.8,.35)", fill: "forwards" },
    );
  });
  exitAnimation = setTimeout(() => {
    letters.replaceChildren();
    exitAnimation = undefined;
  }, 420 + Math.max(0, tiles.length - 1) * 100);
}

function animateGuess(event) {
  if (event.duplicate) return;
  for (const tile of matchingTiles(event.word)) {
    tile.classList.add("used");
    if (event.perfect) tile.classList.add("perfect-used");
  }
}

function matchingTiles(word) {
  const tiles = [...letters.children];
  const requirements = [...word]
    .map((letter) => ({ letter }))
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
  const overlayKey = location.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const socket = new WebSocket(`${protocol}://${location.host}/live?overlay=${encodeURIComponent(overlayKey)}`);
  socket.onmessage = (message) => render(JSON.parse(message.data));
  socket.onclose = () => setTimeout(connect, 1500);
}

connect();
