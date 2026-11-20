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
