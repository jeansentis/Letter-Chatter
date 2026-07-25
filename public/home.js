const connection = document.querySelector("#connection");
const primaryActions = document.querySelector("#primary-actions");

try {
  const status = await fetch("/api/twitch/status").then((response) => response.json());
  if (!status.configured) {
    connection.textContent = "The host still needs to configure the Twitch application.";
    primaryActions.querySelector(".primary").textContent = "Twitch setup needed";
    primaryActions.querySelector(".primary").href = "/control";
  } else if (status.connected || status.authenticated) {
    connection.textContent = `Connected as ${status.login}. Your streamer dashboard is ready.`;
    connection.classList.add("connected");
    primaryActions.querySelector(".primary").textContent = "Open my dashboard";
    primaryActions.querySelector(".primary").href = "/control";
  } else {
    connection.textContent = "Secure Twitch authorization · no chat bot account required";
  }
} catch {
  connection.textContent = "The game server is currently unavailable.";
}
