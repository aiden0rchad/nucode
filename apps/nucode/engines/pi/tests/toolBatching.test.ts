import test from "node:test";
import assert from "node:assert/strict";
import { applyToolBatching, TOOL_BATCHING } from "../extensions/lib/toolBatching.ts";
import { applyResponseStyle } from "../extensions/lib/responseStyle.ts";

test("a string prompt gets the section once, after the response style", () => {
  const styled = applyResponseStyle("Intro\n", "standard");
  const out = applyToolBatching(styled);
  assert.ok(out.endsWith(`\n\n${TOOL_BATCHING}`));
  assert.ok(out.startsWith(styled.trimEnd()));
  assert.equal(applyToolBatching(out), out);
  assert.equal(applyToolBatching(""), TOOL_BATCHING);
});

test("an array prompt gets a last element once and is not mutated", () => {
  const input = ["a", "b"];
  const out = applyToolBatching(input);
  assert.deepEqual(input, ["a", "b"]);
  assert.deepEqual(out, ["a", "b", TOOL_BATCHING]);
  assert.equal(applyToolBatching(out), out);
});

test("applying the response style after batching keeps both sections", () => {
  const out = applyResponseStyle(applyToolBatching(["a"]), "detailed");
  assert.ok(out.includes(TOOL_BATCHING));
  assert.ok(out.some(part => part.includes("Be thorough.")));
});

test("a run of single lookups gets one reminder, then a cooldown", async () => {
  const { LookupStreak, STREAK, COOLDOWN } = await import("../extensions/lib/toolBatching.ts");
  const watch = new LookupStreak();
  const step = (...tools: string[]) => { watch.start(); tools.forEach(t => watch.call(t)); return watch.end(); };
  for (let i = 1; i < STREAK; i++) assert.equal(step("read"), false);
  assert.equal(step("grep"), true);
  for (let i = 0; i < COOLDOWN - 1; i++) assert.equal(step("read"), false, "quiet during the cooldown");
  assert.equal(step("read"), true, "a streak that never broke is reminded again when the cooldown ends");
});

test("batched lookups, edits and commands break the streak", async () => {
  const { LookupStreak } = await import("../extensions/lib/toolBatching.ts");
  const watch = new LookupStreak();
  const step = (...tools: string[]) => { watch.start(); tools.forEach(t => watch.call(t)); return watch.end(); };
  for (const breaker of [["read", "read"], ["edit"], ["bash"], []]) {
    assert.equal(step("read"), false); assert.equal(step("read"), false);
    assert.equal(step(...breaker), false, JSON.stringify(breaker));
  }
});

test("the gate's hook sends the reminder with the last result of the third single-lookup step", async () => {
  const { registerBatchNudge, BATCH_NUDGE } = await import("../extensions/lib/toolBatching.ts");
  const handlers: Record<string, Function> = {};
  registerBatchNudge({ on: (name: string, fn: Function) => { handlers[name] = fn; } } as any);
  handlers.agent_start();
  const step = (...tools: string[]) => { handlers.turn_start(); tools.forEach(t => handlers.tool_call({ toolName: t })); return tools.map(() => handlers.tool_result({})); };
  assert.deepEqual(step("read"), [undefined]);
  assert.deepEqual(step("read", "grep"), [undefined, undefined]);
  assert.deepEqual(step("read"), [undefined]);
  assert.deepEqual(step("glob"), [undefined]);
  assert.deepEqual(step("read"), [{ additionalContext: BATCH_NUDGE }]);
});
