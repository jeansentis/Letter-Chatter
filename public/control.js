const detail = document.querySelector("#twitch-detail");
const action = document.querySelector("#twitch-action");
const dot = document.querySelector("#live-dot");
let overlayPath = null;
let lettersOverlayPath = null;
const numericSettings = [
  "roundSeconds", "countdownSeconds", "shuffleSeconds", "guessCooldownSeconds", "timeBonusSeconds", "minLetters", "maxLetters", "minimumWords", "levelBaseGoal", "levelGrowth", "dynamicPointsPerPlayer",
  "intermissionSeconds", "overlayWidth", "overlayHeight", "timerFontSize",
  "letterFontSize", "wordFontSize", "userFontSize",
];
const colorSettings = ["primaryColor", "secondaryColor", "backgroundColor", "tileColor", "textColor"];
const palettes = {
  candy: { primaryColor: "#ffcf4a", secondaryColor: "#ff5fa2", backgroundColor: "#35245f", tileColor: "#fff3bd", textColor: "#ffffff" },
  sunny: { primaryColor: "#ffe04b", secondaryColor: "#ff7043", backgroundColor: "#3146a8", tileColor: "#fff4b8", textColor: "#ffffff" },
  ocean: { primaryColor: "#42e8ff", secondaryColor: "#7c5cff", backgroundColor: "#123a5a", tileColor: "#d9fbff", textColor: "#ffffff" },
  lime: { primaryColor: "#c6f34a", secondaryColor: "#ff5c8a", backgroundColor: "#263b42", tileColor: "#f4ffd2", textColor: "#ffffff" },
  midnight: { primaryColor: "#ffd66b", secondaryColor: "#9c7cff", backgroundColor: "#171a2a", tileColor: "#fff8df", textColor: "#ffffff" },
};

async function status() {
  const data = await fetch("/api/twitch/status").then((response) => response.json());
  overlayPath = data.overlayPath;
  lettersOverlayPath = resolveLettersOverlayPath(data.lettersOverlayPath, overlayPath);
  updatePreviewSource();
  dot.textContent = data.connected ? "chat connected" : "chat offline";
  dot.className = data.connected ? "connected" : "";
  if (!data.configured) {
    detail.textContent = `Add your Client ID and Client Secret to .env. Register ${data.redirectUri} as the OAuth redirect.`;
    action.innerHTML = "<button disabled>Setup needed</button>";
  } else if (data.connected) {
    detail.textContent = `Listening to ${data.login}'s Twitch chat through EventSub.`;
    action.innerHTML = "<button id=disconnect class=danger>Disconnect</button>";
    document.querySelector("#disconnect").onclick = async () => { await request("/api/twitch/disconnect", "POST"); await status(); };
  } else {
    detail.textContent = data.authenticated ? `Logged in as ${data.login}; reconnecting to chat...` : "Credentials loaded. Authorize the broadcaster account to read its chat messages.";
    action.innerHTML = '<a class="button" href="/auth/twitch">Connect Twitch</a>';
  }
  document.querySelector("#new-round").disabled = !data.connected;
  document.querySelector("#end-round").disabled = !data.connected;
}

async function request(url, method = "GET", body) {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function loadSettings() {
  const settings = await request("/api/settings").then((response) => response.json());
  renderSettings(settings);
}

async function loadLanguages() {
  const languages = await request("/api/languages").then((response) => response.json());
  const container = document.querySelector("#languages");
  container.innerHTML = languages.map((language) => `<div class="language-option"><label><input type="checkbox" value="${escapeAttribute(language.id)}"> ${escapeHtml(language.flag)} ${escapeHtml(language.name)}</label>${language.custom ? `<button type="button" class="remove-language" data-language="${escapeAttribute(language.id)}" title="Remove ${escapeAttribute(language.name)}">×</button>` : ""}</div>`).join("");
  for (const button of container.querySelectorAll(".remove-language")) {
    button.onclick = async () => {
      if (!confirm("Remove this custom language?")) return;
      const response = await request(`/api/languages/${encodeURIComponent(button.dataset.language)}`, "DELETE");
      const result = await response.json();
      document.querySelector("#language-result").textContent = response.ok ? "Language removed." : result.error;
      await loadLanguages();
      await loadSettings();
    };
  }
}

function renderSettings(settings) {
  for (const key of numericSettings) document.querySelector(`#${key}`).value = settings[key];
  document.querySelector("#mode").value = settings.mode;
  const selectedLanguages = settings.languages ?? [settings.language ?? "english"];
  for (const input of document.querySelectorAll("#languages input")) input.checked = selectedLanguages.includes(input.value);
  document.querySelector("#fontFamily").value = settings.fontFamily;
  document.querySelector("#theme").value = settings.theme;
  for (const key of colorSettings) document.querySelector(`#${key}`).value = settings[key];
  document.querySelector("#autoContinue").checked = settings.autoContinue;
  document.querySelector("#replaceUsedLetters").checked = settings.replaceUsedLetters;
  document.querySelector("#dynamicDifficulty").checked = settings.dynamicDifficulty;
  document.querySelector("#intermissionSeconds").disabled = !settings.autoContinue;
  updateConditionalSettings(settings.mode, settings.dynamicDifficulty);
  const frame = document.querySelector(".preview iframe");
  updatePreviewSource();
  frame.width = settings.overlayWidth;
  frame.height = settings.overlayHeight;
  document.querySelector("#preview-size").textContent = `OBS PREVIEW - ${settings.overlayWidth} x ${settings.overlayHeight}`;
}

document.querySelector("#settings-form").onsubmit = async (event) => {
  event.preventDefault();
  const body = {
    mode: document.querySelector("#mode").value,
    languages: [...document.querySelectorAll("#languages input:checked")].map((input) => input.value),
    fontFamily: document.querySelector("#fontFamily").value,
    theme: document.querySelector("#theme").value,
    autoContinue: document.querySelector("#autoContinue").checked,
    replaceUsedLetters: document.querySelector("#replaceUsedLetters").checked,
    dynamicDifficulty: document.querySelector("#dynamicDifficulty").checked,
  };
  for (const key of numericSettings) body[key] = Number(document.querySelector(`#${key}`).value);
  for (const key of colorSettings) body[key] = document.querySelector(`#${key}`).value;
  const response = await request("/api/settings", "PUT", body);
  const result = await response.json();
  renderSettings(result);
  const message = document.querySelector("#settings-result");
  message.textContent = `Saved. Set the OBS browser source to ${result.overlayWidth} x ${result.overlayHeight}.`;
  setTimeout(() => message.textContent = "", 4000);
};
document.querySelector("#mode").onchange = (event) => {
  updateConditionalSettings(event.target.value, document.querySelector("#dynamicDifficulty").checked);
};
document.querySelector("#dynamicDifficulty").onchange = (event) => updateConditionalSettings(document.querySelector("#mode").value, event.target.checked);
document.querySelector("#autoContinue").onchange = (event) => {
  document.querySelector("#intermissionSeconds").disabled = !event.target.checked;
};
document.querySelector("#theme").onchange = (event) => {
  const palette = palettes[event.target.value];
  if (palette) for (const [key, value] of Object.entries(palette)) document.querySelector(`#${key}`).value = value;
};
document.querySelector("#copy-url").onclick = async (event) => {
  await copyOverlayUrl(overlayPath, event.target, "Copy URL");
};
document.querySelector("#copy-letters-url").onclick = async (event) => {
  await copyOverlayUrl(lettersOverlayPath, event.target, "Copy letters URL");
};
document.querySelector("#regenerate-url").onclick = async () => {
  if (!confirm("Rotate the private link? Both current OBS browser sources will stop receiving updates.")) return;
  const response = await request("/api/overlay/regenerate", "POST");
  const result = await response.json();
  if (!response.ok) return;
  overlayPath = result.overlayPath;
  lettersOverlayPath = resolveLettersOverlayPath(result.lettersOverlayPath, overlayPath);
  updatePreviewSource();
  document.querySelector("#settings-result").textContent = "Private links rotated. Copy both new URLs into OBS.";
};
document.querySelector("#logout").onclick = async () => {
  await request("/api/logout", "POST");
  location.href = "/";
};
document.querySelector("#upload-language").onclick = async () => {
  const file = document.querySelector("#language-file").files[0];
  const message = document.querySelector("#language-result");
  if (!file) { message.textContent = "Choose a UTF-8 text file first."; return; }
  if (file.size > 5 * 1024 * 1024) { message.textContent = "Language files are limited to 5 MB."; return; }
  message.textContent = "Uploading and validating…";
  const response = await request("/api/languages", "POST", {
    name: document.querySelector("#language-name").value || file.name.replace(/\.txt$/i, ""),
    flag: document.querySelector("#language-flag").value,
    contents: await file.text(),
  });
  const result = await response.json();
  message.textContent = response.ok ? `${result.flag} ${result.name} is ready to select.` : result.error;
  if (response.ok) {
    await loadLanguages();
    await loadSettings();
    document.querySelector("#language-file").value = "";
  }
};
document.querySelector("#new-round").onclick = () => request("/api/round/new", "POST");
document.querySelector("#end-round").onclick = () => request("/api/round/end", "POST");
document.querySelector("#offline-start").onclick = () => request("/api/dev/start", "POST");
document.querySelector("#guess-form").onsubmit = async (event) => {
  event.preventDefault();
  const response = await request("/api/guess", "POST", {
    username: document.querySelector("#username").value,
    word: document.querySelector("#word").value,
  });
  const result = await response.json();
  document.querySelector("#guess-result").textContent = result.accepted
    ? (result.event.duplicate ? "Already found - 0 points" : `Accepted - ${result.event.score} points`)
    : result.reason.replaceAll("-", " ");
  document.querySelector("#word").select();
};

void Promise.all([status(), loadLanguages().then(loadSettings)]);
setInterval(status, 5000);

function updateConditionalSettings(mode, dynamicDifficulty) {
  const levelMode = mode === "level";
  for (const label of document.querySelectorAll(".level-setting")) label.style.display = levelMode ? "block" : "none";
  for (const label of document.querySelectorAll(".dynamic-setting")) label.style.display = levelMode && dynamicDifficulty ? "block" : "none";
  for (const label of document.querySelectorAll(".fixed-level-setting")) label.style.display = levelMode && !dynamicDifficulty ? "block" : "none";
  for (const label of document.querySelectorAll(".time-setting")) label.style.display = mode === "time" ? "block" : "none";
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function resolveLettersOverlayPath(explicitPath, mainPath) {
  if (explicitPath) return explicitPath;
  return typeof mainPath === "string" && mainPath.startsWith("/overlay/")
    ? `/letters/${mainPath.slice("/overlay/".length)}`
    : null;
}

function updatePreviewSource() {
  if (!overlayPath) return;
  const frame = document.querySelector(".preview iframe");
  if (frame.getAttribute("src") !== overlayPath) frame.setAttribute("src", overlayPath);
}

async function copyOverlayUrl(path, button, idleLabel) {
  if (!path) {
    button.textContent = "URL unavailable";
    setTimeout(() => button.textContent = idleLabel, 1800);
    return;
  }
  try {
    await copyText(new URL(path, location.origin).href);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => button.textContent = idleLabel, 1800);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch { /* Fall back for browsers that block the Clipboard API. */ }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;left:-9999px;opacity:0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard copy was rejected.");
}
