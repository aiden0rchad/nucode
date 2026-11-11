import assert from "node:assert/strict";
import test from "node:test";
import { contextReport } from "../extensions/lib/contextReport.ts";

const tool = (name: string, exposure = "direct", namespace?: string) => ({ name, description: "x".repeat(40), parameters: {}, exposure, namespace: namespace ? { name: namespace } : undefined });
const base = { systemPrompt: "s".repeat(4000), contextFiles: [{ content: "m".repeat(400) }], skills: [{ name: "skill-a", description: "d".repeat(92) }], tools: [] as ReturnType<typeof tool>[], activeTools: [] as string[], usedTokens: 5000 as number | null, window: 100000, reserve: 10000, autoCompact: true };
const row = (report: ReturnType<typeof contextReport>, id: string) => report.rows.find(r => r.id === id)!.tokens;

test("splits MCP and system tools, subtracts memory and skills from the prompt, and does the maths", () => {
  const tools = [tool("read"), tool("mcp__a__go"), tool("custom", "direct", "mcp__b"), tool("mcp__z__later", "deferred"), tool("sys_later", "codemode"), tool("secret", "hidden")];
  const report = contextReport({ ...base, tools, activeTools: ["read", "mcp__a__go", "custom"] });
  const cost = (t: ReturnType<typeof tool>) => Math.ceil(JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length / 4);
  assert.equal(row(report, "memory"), 100);
  assert.equal(row(report, "skills"), Math.ceil(("skill-a " + "d".repeat(92)).length / 4));
  assert.equal(row(report, "systemPrompt"), 1000 - 100 - 25);
  assert.equal(row(report, "systemTools"), cost(tools[0]));
  assert.equal(row(report, "mcpTools"), cost(tools[1]) + cost(tools[2]));
  assert.deepEqual(report.mcpTools, ["custom", "mcp__a__go"]);
  assert.deepEqual(report.deferred, [{ id: "mcpTools", tokens: cost(tools[3]) }, { id: "systemTools", tokens: cost(tools[4]) }]);
  assert.equal(report.used, 5000);
  assert.equal(row(report, "messages")! + 1000 - 100 - 25 + 100 + 25 + cost(tools[0]) + cost(tools[1]) + cost(tools[2]), 5000);
  assert.equal(row(report, "buffer"), 10000);
  assert.equal(row(report, "free"), 100000 - 5000 - 10000);
  assert.equal(report.untilCompact, 100000 - 10000 - 5000);
});

test("unknown usage leaves messages, used, free and untilCompact unknown", () => {
  const report = contextReport({ ...base, usedTokens: null });
  assert.equal(report.used, null);
  assert.equal(row(report, "messages"), null);
  assert.equal(row(report, "free"), null);
  assert.equal(report.untilCompact, null);
  assert.equal(row(report, "buffer"), 10000);
});

test("auto-compact off has no buffer and no countdown", () => {
  const report = contextReport({ ...base, autoCompact: false });
  assert.equal(row(report, "buffer"), 0);
  assert.equal(row(report, "free"), 95000);
  assert.equal(report.untilCompact, null);
});

test("usage below the fixed cost clamps messages to zero and untilCompact never goes negative", () => {
  const small = contextReport({ ...base, usedTokens: 10 });
  assert.equal(row(small, "messages"), 0);
  const over = contextReport({ ...base, usedTokens: 95000 });
  assert.equal(over.untilCompact, 0);
  assert.equal(row(over, "free"), 0);
});

test("omp-style input: tools without exposure, no contextFiles or skills, and an unknown reserve", () => {
  const tools = [{ name: "read", description: "r" }, { name: "inactive", description: "i" }] as any[];
  const report = contextReport({ systemPrompt: "s".repeat(400), contextFiles: [], skills: [], tools, activeTools: ["read"], usedTokens: 1000, window: 100000, reserve: null, autoCompact: true });
  assert.equal(report.autoCompact, true);
  assert.equal(row(report, "buffer"), null);
  assert.equal(row(report, "free"), 99000);
  assert.equal(report.untilCompact, null);
  assert.equal(row(report, "memory"), 0);
  assert.deepEqual(report.deferred, []);
  assert.ok(row(report, "systemTools")! > 0);
  assert.equal(report.used, 1000);
});
