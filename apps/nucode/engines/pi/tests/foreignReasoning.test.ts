import test from "node:test";
import assert from "node:assert/strict";
import { dropArchivedReasoning, dropForeignReasoning, withoutArchivedReasoning, withoutReasoning } from "../extensions/lib/foreignReasoning.ts";

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

const archive = "¶user:read the file\n¶think:PLAN: read it.\n\nThen sum up.\n¶call:read(path=\"a.txt\")\n<out>\n1:¶think:not a label\n¶ai:nor this\n</out>\n¶ai:Done.\n¶think:Last thought.";

test("the model's reasoning is taken out of the archive of older turns", () => {
  const clean = "¶user:read the file\n¶call:read(path=\"a.txt\")\n<out>\n1:¶think:not a label\n¶ai:nor this\n</out>\n¶ai:Done.";
  assert.equal(withoutArchivedReasoning(archive), clean);
  assert.equal(withoutArchivedReasoning(clean), clean);
  // The form omp stores: a block glyph for each line break, control marks around tool output.
  const stored = archive.replaceAll("\n", "\u2588").replace("<out>", "<out>\u000e").replace("</out>", "\u000f</out>");
  assert.equal(withoutArchivedReasoning(stored), clean.replaceAll("\n", "\u2588").replace("<out>", "<out>\u000e").replace("</out>", "\u000f</out>"));
});

test("an archive message is cleaned in its lead-in and its text blocks; other messages are left alone", () => {
  const image = { type: "image", data: "x", mimeType: "image/png" };
  const summary = { role: "compactionSummary", summary: "Resume prior conversation.", blocks: [{ type: "text", text: archive }, image], timestamp: 5 };
  const sent = { role: "user", content: [{ type: "text", text: archive }], historyRewriteAt: 5, timestamp: 5 };
  const plain = { role: "user", content: [{ type: "text", text: archive }], timestamp: 6 };
  const out = dropArchivedReasoning([summary, sent, plain]);
  assert.deepEqual(out, [{ ...summary, blocks: [{ type: "text", text: withoutArchivedReasoning(archive) }, image] }, { ...sent, content: [{ type: "text", text: withoutArchivedReasoning(archive) }] }, plain]);
  assert.equal(dropArchivedReasoning([plain, turn(7, think)]), undefined);
});

test("takes reasoning out of the turns about to be archived and leaves the rest as it was", () => {
  const turn = { role: "assistant", content: [thinking, text, call] };
  const plain = { role: "assistant", content: [text] };
  const out = withoutReasoning([user, turn, result, plain]);
  assert.deepEqual(out[1], { role: "assistant", content: [text, call] });
  assert.deepEqual([out[0], out[2], out[3]], [user, result, plain]);
  assert.equal(turn.content.length, 3);
});
