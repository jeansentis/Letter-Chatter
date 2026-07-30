import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("dashboard status polling does not reload an unchanged overlay preview", async () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const elements = new Map<string, any>();
  let previewNavigations = 0;
  let poll: (() => Promise<void>) | undefined;

  const makeElement = () => {
    const attributes = new Map<string, string>();
    return {
      classList: { add() {}, remove() {}, toggle() {} },
      style: { setProperty() {} },
      dataset: {},
      querySelectorAll: () => [],
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
        if (name === "src") previewNavigations += 1;
      },
    };
  };
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };

  (globalThis as any).document = {
    querySelector: element,
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    body: { append() {} },
    execCommand: () => true,
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/twitch/status")) {
      return Response.json({
        configured: true,
        authenticated: true,
        connected: true,
        login: "tester",
        overlayPath: "/overlay/private-key",
        lettersOverlayPath: "/letters/private-key",
      });
    }
    if (url.endsWith("/api/languages")) return Response.json([]);
    if (url.endsWith("/api/settings")) {
      return Response.json({
        mode: "level",
        languages: ["english"],
        fontFamily: "system",
        theme: "candy",
        autoContinue: true,
        replaceUsedLetters: true,
        dynamicDifficulty: false,
        overlayWidth: 600,
        overlayHeight: 150,
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  globalThis.setInterval = ((callback: () => Promise<void>) => {
    poll = callback;
    return 1 as unknown as NodeJS.Timeout;
  }) as typeof setInterval;

  try {
    const controlUrl = pathToFileURL(path.resolve("public/control.js"));
    controlUrl.searchParams.set("test", String(Date.now()));
    await import(controlUrl.href);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(poll);
    await poll();
    await poll();
    assert.equal(previewNavigations, 1);
  } finally {
    (globalThis as any).document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
  }
});