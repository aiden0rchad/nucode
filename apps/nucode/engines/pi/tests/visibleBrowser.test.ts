import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyVisibleUi, browserAvailable, launchesHeadlessBrowser, registerVisibleBrowser, VISIBLE_UI, HEADLESS_NUDGE, COOLDOWN } from "../extensions/lib/visibleBrowser.ts";

const home = (connectors: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), "visible-"));
  mkdirSync(join(dir, "nucode"));
  writeFileSync(join(dir, "nucode/connectors.json"), JSON.stringify(connectors));
  return dir;
};

test("the section is added once, in the prompt's own shape", () => {
  assert.deepEqual(applyVisibleUi(["a"]), ["a", VISIBLE_UI]);
  assert.deepEqual(applyVisibleUi(applyVisibleUi(["a"])), ["a", VISIBLE_UI]);
  const text = applyVisibleUi("Intro\n");
  assert.equal(text, `Intro\n\n${VISIBLE_UI}`);
  assert.equal(applyVisibleUi(text), text);
});

test("the browser counts as available only when its connector can navigate", () => {
  const dirs = [
    home([{ id: "nucode-browser", enabled: true }]),
    home([{ id: "nucode-browser", enabled: false }]),
    home([{ id: "nucode-browser", enabled: true, toolAllowlist: ["browser_snapshot"] }]),
    home([{ id: "nucode-browser", enabled: true, toolDenylist: ["browser_navigate"] }]),
    home([{ id: "codegraph", enabled: true }]),
  ];
  try {
    assert.deepEqual(dirs.map(d => browserAvailable(d)), [true, false, false, false, false]);
    assert.equal(browserAvailable(join(tmpdir(), "missing-home")), false);
    const chat = process.env.NUCODE_CHAT; process.env.NUCODE_CHAT = "1";
    try { assert.equal(browserAvailable(dirs[0]), false); } finally { if (chat === undefined) delete process.env.NUCODE_CHAT; else process.env.NUCODE_CHAT = chat; }
  } finally { dirs.forEach(d => rmSync(d, { recursive: true, force: true })); }
});

test("throwaway headless scripts are spotted; the project's test suite is not", () => {
  assert.equal(launchesHeadlessBrowser("eval", { code: "from playwright.sync_api import sync_playwright\nwith sync_playwright() as p: p.chromium.launch()" }), true);
  assert.equal(launchesHeadlessBrowser("bash", { command: "python3 - <<'EOF'\nfrom playwright.sync_api import sync_playwright\nEOF" }), true);
  assert.equal(launchesHeadlessBrowser("bash", { command: "node -e \"require('puppeteer').launch()\" # puppeteer.launch" }), true);
  assert.equal(launchesHeadlessBrowser("bash", { command: "cd ui && npx playwright test -g 'pause'" }), false);
  assert.equal(launchesHeadlessBrowser("bash", { command: "npm --prefix ui run test:browser" }), false);
  assert.equal(launchesHeadlessBrowser("bash", { command: "grep -rn chromium src" }), false);
  assert.equal(launchesHeadlessBrowser("read", { path: "capture.py" }), false);
});

test("the reminder comes with the result of a headless script, then waits out a cooldown", () => {
  const dir = home([{ id: "nucode-browser", enabled: true }]);
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const handlers: Record<string, Function> = {};
    registerVisibleBrowser({ on: (name: string, fn: Function) => { handlers[name] = fn; } } as any);
    handlers.agent_start();
    const script = { toolName: "eval", input: { code: "sync_playwright()" } };
    assert.deepEqual(handlers.tool_result(script), { additionalContext: HEADLESS_NUDGE });
    for (let i = 0; i < COOLDOWN; i++) assert.equal(handlers.tool_result(script), undefined);
    assert.deepEqual(handlers.tool_result(script), { additionalContext: HEADLESS_NUDGE });
    assert.equal(handlers.tool_result({ toolName: "bash", input: { command: "ls" } }), undefined);
    writeFileSync(join(dir, "nucode/connectors.json"), JSON.stringify([{ id: "nucode-browser", enabled: false }]));
    handlers.agent_start();
    assert.equal(handlers.tool_result(script), undefined, "no reminder without an in-app browser");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
