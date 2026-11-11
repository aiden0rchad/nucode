import test from "node:test";
import assert from "node:assert/strict";
import { dropForeignReasoning } from "../extensions/lib/foreignReasoning.ts";

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
