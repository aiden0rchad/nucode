import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_LIMIT, LOOP_CLOSED, LOOP_NUDGE, LoopWatch, registerLoopGuard, stepSignature } from "../extensions/lib/loopGuard.ts";

test("steps that differ only by a counter are one step, and so is a picture opened from another folder or format; new text written is not", () => {
  assert.equal(stepSignature("read", { path: "/tmp/z6/alerts-1440.jpg", i: "Viewing alerts" }), stepSignature("read", { path: "/tmp/copies/b/alerts-1440.png:1-20" }));
  assert.notEqual(stepSignature("read", { path: "/tmp/shots/alerts-1440.png" }), stepSignature("read", { path: "/tmp/shots/alerts-390.png" }), "one screen at two widths is two pictures");
  assert.equal(stepSignature("bash", { command: "cp shots/a.png /tmp/r6/a.png" }), stepSignature("bash", { command: "cp shots/a.png /tmp/r7/a.png" }));
  assert.notEqual(stepSignature("read", { path: "src/alerts.ts" }), stepSignature("read", { path: "src/reports.ts" }));
  assert.equal(stepSignature("bash", { command: "npm test", timeout: 5 }), stepSignature("bash", { timeout: 9, command: "npm test" }));
  assert.notEqual(stepSignature("edit", { path: "a.ts", text: "one" }), stepSignature("edit", { path: "a.ts", text: "two" }));
  assert.equal(stepSignature("bash", undefined), stepSignature("bash", {}));
});

// Copy the same screenshots to a new folder and open them again, round after round.
const loop = (round: number) => ["alerts", "reports", "logs"].flatMap(name => [["bash", { command: `cp shots/${name}.png /tmp/r${round}/${name}.png` }], ["read", { path: `/tmp/r${round}/${name}.png` }]] as const);

test("a run is caught once its last steps are all repeats, and ordinary work is not", () => {
  const circling = new LoopWatch();
  const hits: number[] = [];
  for (let round = 0, n = 0; round < 20; round++) for (const [tool, input] of loop(round)) { n++; if (circling.push(stepSignature(tool, input))) hits.push(n); }
  assert.deepEqual(hits, [36, 72, 108], "told after 36 repeated steps, then again every 36");
  // Fix and test the same file forty times: every edit is new text.
  const fixing = new LoopWatch();
  for (let round = 0; round < 40; round++) for (const [tool, input] of [["edit", { path: "a.ts", text: `try ${"x".repeat(round)}` }], ["bash", { command: "npm test" }], ["read", { path: "a.ts" }]] as const) assert.equal(fixing.push(stepSignature(tool, input)), false);
  // A few new steps among the repeats do not hide a loop.
  const mixed = new LoopWatch();
  let first = 0;
  for (let round = 0, n = 0; round < 20 && !first; round++) for (const [tool, input] of [...loop(round), ...(round % 2 ? [["bash", { command: `echo note-${"x".repeat(round)}` }] as const] : [])]) { n++; if (mixed.push(stepSignature(tool, input))) { first = n; break; } }
  assert.ok(first > 0 && first <= 50, `caught at step ${first}`);
  // Review twenty screens in two themes at three widths, then look again at a few.
  const reviewing = new LoopWatch();
  const screens = Array.from({ length: 20 }, (_, index) => `screen${String.fromCharCode(97 + index)}`);
  for (const screen of screens) for (const theme of ["light", "dark"]) for (const width of [1280, 390, 320]) assert.equal(reviewing.push(stepSignature("read", { path: `/tmp/qa/${screen}-${theme}-${width}.png` })), false);
  // Read two hundred different files.
  const reading = new LoopWatch();
  for (const name of Array.from({ length: 200 }, (_, index) => `src/${String.fromCharCode(97 + index % 26)}${String.fromCharCode(97 + Math.floor(index / 26))}/mod.ts`)) assert.equal(reading.push(stepSignature("read", { path: name })), false);
});

function guard(t: any, depth: string) {
  const previous = process.env.NUCODE_SUBAGENT_DEPTH;
  process.env.NUCODE_SUBAGENT_DEPTH = depth;
  t.after(() => { if (previous === undefined) delete process.env.NUCODE_SUBAGENT_DEPTH; else process.env.NUCODE_SUBAGENT_DEPTH = previous; });
  const hooks = new Map<string, any>();
  registerLoopGuard({ on: (name: string, fn: any) => hooks.set(name, fn) } as never);
  hooks.get("agent_start")();
  const run = (rounds: number) => Array.from({ length: rounds }, (_, round) => loop(round)).flat().map(([toolName, input]) => hooks.get("tool_call")({ toolName, input })?.reason);
  return { hooks, run };
}

test("a child agent is told twice, then loses its tools; a new run starts clean", t => {
  const { hooks, run } = guard(t, "1");
  const reasons = run(20);
  assert.deepEqual(reasons.slice(0, 35), Array(35).fill(undefined), "nothing is blocked before the run has circled");
  assert.equal(reasons[35], LOOP_NUDGE);
  assert.equal(reasons[71], LOOP_NUDGE);
  assert.equal(reasons[107], LOOP_CLOSED);
  assert.ok(reasons.slice(107).every(reason => reason === LOOP_CLOSED), "every later step is refused");
  assert.equal(reasons.filter(reason => reason === LOOP_NUDGE).length, 2);
  hooks.get("agent_start")();
  assert.equal(hooks.get("tool_call")({ toolName: "read", input: { path: "a.ts" } }), undefined);
});

test("the agent the user talks to is told but keeps its tools", t => {
  const reasons = guard(t, "0").run(30);
  assert.equal(reasons.filter(reason => reason === LOOP_NUDGE).length, 5);
  assert.ok(!reasons.includes(LOOP_CLOSED));
});

test("a third image in one step is refused through an OpenAI-format proxy, and only there", t => {
  const { hooks } = guard(t, "1");
  const step = (model: unknown, paths: string[]) => { hooks.get("turn_start")(); return paths.map(path => hooks.get("tool_call")({ toolName: "read", input: { path } }, { model })?.reason); };
  const proxy = { api: "openai-responses", baseUrl: "http://proxy.example:4000/v1" };
  assert.deepEqual(step(proxy, ["a.png", "src/a.ts", "b.jpg", "c.webp", "d.png"]), [undefined, undefined, undefined, IMAGE_LIMIT, IMAGE_LIMIT]);
  assert.deepEqual(step(proxy, ["c.webp", "d.png"]), [undefined, undefined], "the next step starts a new count");
  assert.ok(IMAGE_LIMIT.includes("next step"));
  for (const model of [{ api: "openai-responses", baseUrl: "https://api.openai.com/v1" }, { api: "anthropic-messages", baseUrl: "https://api.anthropic.com" }, { api: "openai-completions" }, undefined])
    assert.deepEqual(step(model, ["a.png", "b.png", "c.png"]), [undefined, undefined, undefined], JSON.stringify(model));
});
