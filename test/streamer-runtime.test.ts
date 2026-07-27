import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { config } from "../src/config.js";
import { StreamerManager, type StreamerProfile } from "../src/streamer-runtime.js";

test("isolates settings, overlays, scores, and uploaded languages by streamer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "letter-chatters-streamers-"));
  try {
    fs.mkdirSync(path.join(root, "data", "languages"), { recursive: true });
    const profiles: StreamerProfile[] = [
      { userId: "100", login: "alpha", overlayKey: "alpha-private-key" },
      { userId: "200", login: "bravo", overlayKey: "bravo-private-key" },
    ];
    for (const profile of profiles) {
      const directory = path.join(root, "data", "streamers", profile.userId);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "profile.json"), JSON.stringify(profile));
    }

    const manager = new StreamerManager(root, config.game, { clientId: "", clientSecret: "", redirectUri: "" });
    const alpha = manager.get("100")!;
    const bravo = manager.get("200")!;
    alpha.updateSettings({ roundSeconds: 123 });
    alpha.installLanguage("Testish", "🧪", "ALPHA\nBRAVO\nCHARLIE\n");

    assert.equal(manager.size, 2);
    assert.equal(manager.forOverlay("alpha-private-key"), alpha);
    assert.equal(manager.forOverlay("bravo-private-key"), bravo);
    const rotatedKey = manager.regenerateOverlayKey("100");
    assert.notEqual(rotatedKey, "alpha-private-key");
    assert.equal(manager.forOverlay("alpha-private-key"), undefined);
    assert.equal(manager.forOverlay(rotatedKey), alpha);
    assert.equal(alpha.settings.get().roundSeconds, 123);
    assert.notEqual(bravo.settings.get().roundSeconds, 123);
    assert.equal(bravo.settings.get().mode, "level");
    assert.equal(alpha.languageList().some((language) => language.id === "custom-testish"), true);
    assert.equal(bravo.languageList().some((language) => language.id === "custom-testish"), false);
    manager.stopAll();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
