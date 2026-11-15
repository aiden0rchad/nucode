import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WINDOW = 36, REPEATS = 3, CLOSE_AFTER = 3;
// A call that writes new text is progress even when it goes to the same file again.
const WRITES = new Set(["edit", "write", "multiedit", "apply_patch"]);

/** A tool call reduced to what it does. Names that differ only by a counter or an image format are one step. */
export function stepSignature(tool: string, input: unknown): string {
  const { i: _note, intent: _intent, ...rest } = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))) ?? "";
  if (WRITES.has(tool)) return `${tool}|${createHash("sha1").update(text).digest("hex").slice(0, 12)}`;
  return `${tool}|${text.replace(/\.(png|jpe?g|webp)\b/g, ".img").replace(/[A-Za-z]*\d+[A-Za-z]*/g, "#").slice(0, 300)}`;
}

/** Spots a run going in circles: its last WINDOW steps each repeat a step it has already made REPEATS times. */
export class LoopWatch {
  hits = 0;
  private counts = new Map<string, number>();
  private recent: string[] = [];
  private since = 0;
  push(signature: string): boolean {
    this.counts.set(signature, (this.counts.get(signature) ?? 0) + 1);
    this.recent.push(signature);
    if (this.recent.length > WINDOW) this.recent.shift();
    if (++this.since < WINDOW || this.recent.some(step => this.counts.get(step)! < REPEATS)) return false;
    this.since = 0; this.hits++;
    return true;
  }
}

export const LOOP_NUDGE = `This step was not run. Your last ${WINDOW} steps all repeat steps you have already made ${REPEATS} or more times, so this run is going in circles. Do not make them again. Work from what you already have: write down your result now, or say plainly what is blocking you.`;
export const LOOP_CLOSED = "Tools are closed for this run because it kept repeating the same steps. Reply now with your final report from what you already have, and say what is unfinished.";

// An agent that loops keeps its parent waiting and spends without limit. The first two times it is told so in place
// of the repeated step; a child agent that still goes on loses its tools and has to report. The agent the user talks
// to is only told, because the user can see it and stop it.
export function registerLoopGuard(pi: ExtensionAPI) {
  const child = Number(process.env.NUCODE_SUBAGENT_DEPTH ?? 0) > 0;
  let watch = new LoopWatch(), closed = false;
  pi.on("agent_start", () => { watch = new LoopWatch(); closed = false; });
  pi.on("tool_call", event => {
    if (closed) return { block: true, reason: LOOP_CLOSED };
    if (!watch.push(stepSignature(event.toolName, event.input))) return;
    if (child && watch.hits >= CLOSE_AFTER) { closed = true; return { block: true, reason: LOOP_CLOSED }; }
    return { block: true, reason: LOOP_NUDGE };
  });
}
