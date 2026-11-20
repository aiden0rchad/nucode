import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { decide, type Access } from "./policy.ts";

// The in-app browser returns screenshots inline and ignored `filename`, so a report could cite screenshots that
// were never written. The gate saves them instead, under the same write rules as the write tool.
export const SCREENSHOT_TOOL = "mcp__nucode_browser_browser_take_screenshot";

type Content = { type: string; data?: string; text?: string };

/** The filename a screenshot call asked for, whether called directly or through its xd:// device. */
export function screenshotFilename(toolName: string, input: any, details: any): string | undefined {
  let args: any;
  if (toolName === SCREENSHOT_TOOL) args = input;
  else if (toolName === "write" && (details?.xdev?.tool === SCREENSHOT_TOOL || input?.path === `xd://${SCREENSHOT_TOOL}`)) {
    args = details?.xdev?.args;
    if (!args && typeof input?.content === "string") { try { args = JSON.parse(input.content); } catch { /* not JSON */ } }
  }
  const name = args?.filename;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** Writes the returned image to `filename` when `allowed` says this thread may write there; returns a note for the agent. */
export function saveScreenshot(content: Content[] | undefined, filename: string, cwd: string, allowed: (path: string) => boolean): string {
  const image = content?.find(part => part?.type === "image" && typeof part.data === "string" && part.data.length > 0);
  if (!image) return `No image came back, so nothing was saved to ${filename}.`;
  const path = resolve(cwd, filename);
  if (!/\.png$/i.test(path)) return `Not saved: the screenshot is a PNG, so give the filename a .png extension (${filename}).`;
  if (!allowed(path)) return `Not saved to ${path}: this thread can't write there without approval. Save it inside the project, or ask the user.`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(image.data!, "base64"));
  return `Saved the screenshot to ${path}.`;
}

export function registerScreenshotFiles(pi: ExtensionAPI) {
  pi.on("tool_result", (event: any, ctx: any) => {
    if (event.isError) return;
    const filename = screenshotFilename(event.toolName, event.input, event.details);
    if (!filename) return;
    let note: string;
    try {
      const home = process.env.PI_CODING_AGENT_DIR!, session = process.env.NUCODE_SESSION_KEY;
      if (!home || !session || !/^[\w-]+$/.test(session)) throw new Error("no thread access policy");
      const access = JSON.parse(readFileSync(join(home, "nucode", "threads", `${session}.json`), "utf8")) as Access;
      const child = process.env.NUCODE_SUBAGENT_DEPTH ? { workspace: process.env.NUCODE_WORKSPACE!, toolAccess: process.env.NUCODE_TOOL_ACCESS ?? "read-only" } : undefined;
      note = saveScreenshot(event.content, filename, ctx.cwd, path => decide(access, { tool: "write", path, cwd: ctx.cwd }, home, false, child) === "allow");
    } catch (error) {
      note = `Not saved to ${filename}: ${error instanceof Error ? error.message : String(error)}.`;
    }
    return { content: [...(event.content ?? []), { type: "text", text: note }] } as any;
  });
}
