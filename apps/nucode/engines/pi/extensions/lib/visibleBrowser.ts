import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Recorded build threads never opened the in-app browser: every look at a page was a throwaway headless Playwright
// script, so the user watching the thread could not see what was checked. The user watches the in-app browser.
const HEADING = "# Checking the UI";
export const VISIBLE_UI = `${HEADING}

- Show your work where the user can see it. The user watches the in-app browser (the mcp__nucode_browser__browser_* tools), so every UI check happens there by default: open the page with browser_navigate, look with browser_snapshot or browser_take_screenshot, and click or type through the flow.
- To check a layout at a given width (a phone, a tablet), call browser_resize with that width and look again; call it with no width when you are done so the browser follows the pane again.
- When you finish, leave the page you checked open in the browser so the user can look at it. Don't close it unless the user asks.
- Run headless browser checks (Playwright, Puppeteer, Selenium scripts, or captures nobody can watch) only when the user or the project's instructions ask for them, and say when you do. The project's own browser test suite still runs as usual.`;

/** True when this thread can reach the in-app browser's navigate tool. */
export function browserAvailable(home = process.env.PI_CODING_AGENT_DIR): boolean {
  if (!home || process.env.NUCODE_CHAT === "1") return false;
  try {
    const connectors = JSON.parse(readFileSync(join(home, "nucode/connectors.json"), "utf8")) as { id?: string; enabled?: boolean; toolAllowlist?: string[] | null; toolDenylist?: string[] | null }[];
    const browser = connectors.find(c => c.id === "nucode-browser");
    if (!browser?.enabled) return false;
    if (browser.toolAllowlist && !browser.toolAllowlist.includes("browser_navigate")) return false;
    return !browser.toolDenylist?.includes("browser_navigate");
  } catch { return false; }
}

/** Adds the section once, in the same shape the prompt was given (string for pi, string[] for omp). */
export function applyVisibleUi<T extends string | string[]>(prompt: T): T {
  if (Array.isArray(prompt)) return (prompt.some(part => part.startsWith(HEADING)) ? prompt : [...prompt, VISIBLE_UI]) as T;
  const text = prompt as string;
  if (text.includes(`\n${HEADING}\n`) || text.startsWith(`${HEADING}\n`)) return prompt;
  const head = text.trimEnd();
  return (head ? `${head}\n\n${VISIBLE_UI}` : VISIBLE_UI) as T;
}

const HEADLESS = /\b(?:sync_playwright|async_playwright|chromium\.launch|firefox\.launch|webkit\.launch|puppeteer\.launch|webdriver\.(?:Chrome|Firefox|Safari))\b/;
const SUITE = /\bplaywright\s+test\b|\btest:browser\b|\btest:e2e\b/;
export const COOLDOWN = 8;
export const HEADLESS_NUDGE = "That command drove a headless browser the user cannot see. Do UI checks in the in-app browser (mcp__nucode_browser__browser_navigate, then browser_snapshot or browser_take_screenshot) so the user can watch, and run headless checks only when the user or the project's instructions ask for them.";

/** The code a call runs, when it is a shell command or an eval cell. */
export function scriptOf(tool: string, input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;
  if (tool === "bash") return typeof value.command === "string" ? value.command : "";
  if (tool === "eval") return typeof value.code === "string" ? value.code : "";
  return "";
}
export function launchesHeadlessBrowser(tool: string, input: unknown): boolean {
  const code = scriptOf(tool, input);
  return HEADLESS.test(code) && !SUITE.test(code);
}

export function registerVisibleBrowser(pi: ExtensionAPI) {
  let quiet = 0;
  pi.on("agent_start", () => { quiet = 0; });
  pi.on("tool_result", event => {
    if (quiet > 0) { quiet--; return; }
    if (!launchesHeadlessBrowser(event.toolName, event.input) || !browserAvailable()) return;
    quiet = COOLDOWN;
    return { additionalContext: HEADLESS_NUDGE } as any;
  });
}
