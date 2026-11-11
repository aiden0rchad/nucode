import test from "node:test";
import assert from "node:assert/strict";
import { applyResponseStyle, parseResponseStyle } from "../extensions/lib/responseStyle.ts";

const H = "# How to work and report";
const base = "Intro\n\nGuidelines:\n- Use tools\n- Be concise in your responses\n- Show paths\n\nEnd";
const count = (text: string) => text.split(H).length - 1;

test("standard and detailed drop the concise rule and append their section", () => {
  for (const style of ["standard", "detailed"] as const) {
    const out = applyResponseStyle(base, style);
    assert.ok(!/Be concise in your responses/.test(out));
    assert.ok(out.includes("- Use tools\n- Show paths"));
    assert.ok(out.endsWith("\n\nEnd\n\n" + out.slice(out.indexOf(H))));
    assert.equal(count(out), 1);
  }
  assert.ok(applyResponseStyle(base, "detailed").includes("Be thorough."));
  assert.ok(applyResponseStyle(base, "standard").includes("Make the final reply as long as the work needs."));
});

test("array prompts get a new last element and the input is not mutated", () => {
  const input = ["a", "- Be concise in your responses.\n- Other", "b"];
  const copy = [...input];
  const out = applyResponseStyle(input, "standard");
  assert.deepEqual(input, copy);
  assert.equal(out.length, 4);
  assert.ok(out[3].startsWith(H));
  assert.ok(!out.some(part => /Be concise/.test(part)));
  assert.ok(out[1].includes("- Other"));
});

test("concise keeps an existing rule and adds its section otherwise", () => {
  assert.equal(applyResponseStyle(base, "concise"), base);
  const arr = ["x", "- Be concise in your responses"];
  assert.equal(applyResponseStyle(arr, "concise"), arr);
  const out = applyResponseStyle("Intro\n", "concise");
  assert.equal(out, `Intro\n\n${H}\n\n- Be concise in your responses.`);
  assert.deepEqual(applyResponseStyle(["x"], "concise"), ["x", `${H}\n\n- Be concise in your responses.`]);
});

test("applying styles repeatedly leaves one section", () => {
  const once = applyResponseStyle(base, "standard");
  assert.equal(applyResponseStyle(once, "standard"), once);
  const detailed = applyResponseStyle(once, "detailed");
  assert.equal(count(detailed), 1);
  assert.ok(detailed.includes("Be thorough."));
  const concise = applyResponseStyle(detailed, "concise");
  assert.equal(count(concise), 1);
  assert.ok(concise.endsWith("- Be concise in your responses."));
  const arr = applyResponseStyle(applyResponseStyle(["a"], "standard"), "detailed");
  assert.equal(arr.length, 2);
  assert.ok(arr[1].includes("Be thorough."));
});

test("parseResponseStyle defaults to standard", () => {
  assert.equal(parseResponseStyle(undefined), "standard");
  assert.equal(parseResponseStyle("nope"), "standard");
  assert.equal(parseResponseStyle("concise"), "concise");
  assert.equal(parseResponseStyle("detailed"), "detailed");
});
