import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import gate from "../extensions/nucode-gate.ts";

test("chat gate blocks every tool, with explicit Web exceptions", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat-gate-"));
  const before = { ...process.env };
  try {
    process.env.NUCODE_CHAT = "1";
    delete process.env.NUCODE_CHAT_WEB;
    process.env.PI_CODING_AGENT_DIR = root;
    process.env.NUCODE_SESSION_KEY = "chat";
    mkdirSync(join(root, "nucode/threads"), { recursive: true });
    writeFileSync(join(root, "nucode/threads/chat.json"), JSON.stringify({ accessMode: "full-access", sessionAllow: [] }));
    writeFileSync(join(root, "nucode/connectors.json"), JSON.stringify([{ id: "nucode-browser", enabled: true, approval: "auto", toolAllowlist: ["browser_navigate", "browser_snapshot", "browser_take_screenshot", "web_search", "web_fetch"] }]));
    let handler: (event: any, context: any) => Promise<any> = async () => { throw new Error("Missing gate handler"); };
    gate({ on: (event: string, callback: typeof handler) => { if (event === "tool_call") handler = callback; } } as never);
    const call = (toolName: string) => handler({ toolName, input: {}, toolCallId: "call" }, { cwd: root, hasUI: false });
    for (const tool of ["read", "bash", "write", "edit", "subagent", "unknown", "mcp__nucode_browser__browser_navigate"]) assert.equal((await call(tool)).block, true);
    process.env.NUCODE_CHAT_WEB = "1";
    for (const tool of ["browser_navigate", "browser_snapshot", "browser_take_screenshot", "web_search", "web_fetch"]) assert.equal(await call(`mcp__nucode_browser__${tool}`), undefined);
    for (const tool of ["browser_click", "browser_evaluate", "browser_tabs", "browser_navigate_back"]) assert.equal((await call(`mcp__nucode_browser__${tool}`)).block, true);
    for (const tool of ["read", "bash", "subagent", "mcp__other__browser_snapshot"]) assert.equal((await call(tool)).block, true);
  } finally {
    for (const key of ["NUCODE_CHAT", "NUCODE_CHAT_WEB", "PI_CODING_AGENT_DIR", "NUCODE_SESSION_KEY"]) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});
