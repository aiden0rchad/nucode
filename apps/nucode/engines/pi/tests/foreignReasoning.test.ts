import test from "node:test";
import assert from "node:assert/strict";
import { dropForeignReasoning, dropStaleReasoning } from "../extensions/lib/foreignReasoning.ts";

const target = { provider: "proxy", id: "Model B" };
const user = { role: "user", content: "hello" };
const thinking = { type: "thinking", thinking: "**Planning the search**" };
const text = { type: "text", text: "Here is the answer." };
const call = { type: "toolCall", id: "call_1", name: "read", arguments: {} };
const result = { role: "toolResult", toolCallId: "call_1", content: [{ type: "text", text: "file" }] };

test("removes another model's reasoning and keeps its answer and tool calls", () => {
  const other = { role: "assistant", provider: "proxy", model: "Model A", content: [thinking, text, call] };
  const out = dropForeignReasoning([user, other, result], target);
  assert.deepEqual(out, [user, { ...other, content: [text, call] }, result]);
  assert.equal(other.content.length, 3, "the stored message is not modified");
});

test("leaves the answering model's own reasoning alone", () => {
  const own = { role: "assistant", provider: "proxy", model: "Model B", content: [thinking, text] };
  assert.equal(dropForeignReasoning([user, own], target), undefined);
});

test("treats the same model name on another provider as another model", () => {
  const other = { role: "assistant", provider: "elsewhere", model: "Model B", content: [{ type: "redactedThinking", data: "x" }, text] };
  assert.deepEqual(dropForeignReasoning([other], target), [{ ...other, content: [text] }]);
});

test("drops a turn that held only reasoning", () => {
  const only = { role: "assistant", provider: "proxy", model: "Model A", content: [thinking] };
  assert.deepEqual(dropForeignReasoning([user, only, user], target), [user, user]);
});

test("changes nothing without reasoning, without a target, or for plain-string content", () => {
  const plain = { role: "assistant", provider: "proxy", model: "Model A", content: [text] };
  assert.equal(dropForeignReasoning([user, plain], target), undefined);
  assert.equal(dropForeignReasoning([{ ...plain, content: [thinking] }], undefined), undefined);
  assert.equal(dropForeignReasoning([{ ...plain, content: "legacy text" }], target), undefined);
});

const think = { type: "thinking", thinking: "plan", thinkingSignature: "sig" };
const turn = (timestamp: number, ...content: object[]) => ({ role: "assistant", timestamp, content });

test("reasoning written before a summary took the place of older turns is dropped, later reasoning stays", () => {
  const summary = { role: "compactionSummary", summary: "so far", timestamp: 50 };
  const kept = turn(40, think, call), after = turn(60, think, call);
  assert.deepEqual(dropStaleReasoning([summary, kept, after]), [summary, { ...kept, content: [call] }, after]);
  // The engine can date the rewrite before the kept turns when their reasoning is still good.
  assert.equal(dropStaleReasoning([{ ...summary, historyRewriteAt: 30 }, kept, after]), undefined);
  // The same summary once the engine has turned it into a plain message.
  assert.deepEqual(dropStaleReasoning([{ role: "user", content: "so far", historyRewriteAt: 50, timestamp: 50 }, kept]), [{ role: "user", content: "so far", historyRewriteAt: 50, timestamp: 50 }, { ...kept, content: [call] }]);
});

test("cutting down an old tool result drops the reasoning of the turns after it, not of the turns before", () => {
  const before = turn(10, think, call), pruned = { role: "toolResult", toolCallId: "c1", content: [], prunedAt: 30, timestamp: 11 };
  const between = turn(20, think, call), after = turn(40, think, call);
  assert.deepEqual(dropStaleReasoning([before, pruned, between, after]), [before, pruned, { ...between, content: [call] }, after]);
});

test("a refusal of the whole history with nothing written drops the reasoning before it", () => {
  const first = turn(10, think, call), refused = { role: "assistant", timestamp: 20, stopReason: "error", errorMessage: "incomplete: content_filter", content: [] };
  assert.deepEqual(dropStaleReasoning([first, refused]), [{ ...first, content: [call] }, refused]);
  // An answer cut off part-way is a different stop: the history was accepted.
  assert.equal(dropStaleReasoning([first, { ...refused, content: [{ type: "text", text: "Half an" }] }]), undefined);
  assert.equal(dropStaleReasoning([first, turn(20, think)]), undefined);
});
