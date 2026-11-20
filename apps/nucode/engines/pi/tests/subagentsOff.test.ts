import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import subagents, { SUBAGENTS_OFF } from "../extensions/nucode-subagents.ts";

test("a thread whose subagents are off has no subagent tool until they are on again", async t => {
  const home = mkdtempSync(join(tmpdir(), "nucode-off-"));
  mkdirSync(join(home, "nucode"));
  const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, NUCODE_SESSION_KEY: process.env.NUCODE_SESSION_KEY, NUCODE_SUBAGENT_DEPTH: process.env.NUCODE_SUBAGENT_DEPTH };
  Object.assign(process.env, { PI_CODING_AGENT_DIR: home, NUCODE_SUBAGENT_DEPTH: "0" });
  delete process.env.NUCODE_SESSION_KEY;
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; rmSync(home, { recursive: true, force: true }); });
  const write = (enabled: boolean) => writeFileSync(join(home, "nucode/policy.json"), JSON.stringify({ enabled, mode: "custom", maxConcurrent: 2, maxPerTurn: 4, maxDepth: 1, allowedModels: [], roles: [] }));
  let active = ["read", "write", "subagent", "report_verification"];
  const events: Record<string, (...args: any[]) => any> = {};
  subagents({ on: (name: string, fn: any) => { events[name] = fn; }, registerTool() {}, getActiveTools: () => active, setActiveTools: async (names: string[]) => { active = names; } } as any);

  write(false);
  const off = await events.before_agent_start();
  assert.equal(off.message.content, SUBAGENTS_OFF);
  assert.deepEqual(active, ["read", "write", "report_verification"]);
  await events.before_agent_start();
  assert.deepEqual(active, ["read", "write", "report_verification"], "stays off without churning the tool list");

  write(true);
  const on = await events.before_agent_start();
  assert.match(on.message.content, /Subagent policy: \{"enabled":true/);
  assert.ok(active.includes("subagent"), "turning the team back on restores the tool");

  // A tool the gate never activated (subagents switched off app-wide) is not brought back.
  active = ["read", "write"];
  const fresh: Record<string, (...args: any[]) => any> = {};
  subagents({ on: (name: string, fn: any) => { fresh[name] = fn; }, registerTool() {}, getActiveTools: () => active, setActiveTools: async (names: string[]) => { active = names; } } as any);
  await fresh.before_agent_start();
  assert.deepEqual(active, ["read", "write"]);
});
