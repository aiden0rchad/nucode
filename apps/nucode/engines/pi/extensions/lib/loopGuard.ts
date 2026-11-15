import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WINDOW = 36, REPEATS = 3, FRESH = 4, CLOSE_AFTER = 3, IMAGES_PER_STEP = 2;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
// A call that writes new text is progress even when it goes to the same file again.
const WRITES = new Set(["edit", "write", "multiedit", "apply_patch"]);

/** The image a read opens, or undefined when it opens something else. */
export function imageRead(tool: string, input: unknown): string | undefined {
  const path = tool === "read" ? (input as { path?: unknown } | undefined)?.path : undefined;
  if (typeof path !== "string") return undefined;
  const file = path.replace(/:[^/]*$/, "");
  return IMAGE.test(file) ? file : undefined;
}

/** A tool call reduced to what it does. Names that differ only by a counter are one step; so is one picture opened
 * again from another folder or in another format. */
export function stepSignature(tool: string, input: unknown): string {
  const image = imageRead(tool, input);
  if (image) return `read|image|${image.split("/").pop()!.replace(IMAGE, "")}`;
  const { i: _note, intent: _intent, ...rest } = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))) ?? "";
  if (WRITES.has(tool)) return `${tool}|${createHash("sha1").update(text).digest("hex").slice(0, 12)}`;
  return `${tool}|${text.replace(/\.(png|jpe?g|webp)\b/g, ".img").replace(/[A-Za-z]*\d+[A-Za-z]*/g, "#").slice(0, 300)}`;
}

/** Spots a run going in circles: all but FRESH of its last WINDOW steps repeat a step it has already made REPEATS times. */
export class LoopWatch {
  hits = 0;
  private counts = new Map<string, number>();
  private recent: string[] = [];
  private since = 0;
  push(signature: string): boolean {
    this.counts.set(signature, (this.counts.get(signature) ?? 0) + 1);
    this.recent.push(signature);
    if (this.recent.length > WINDOW) this.recent.shift();
    if (++this.since < WINDOW || this.recent.filter(step => this.counts.get(step)! < REPEATS).length > FRESH) return false;
    this.since = 0; this.hits++;
    return true;
  }
}

export const LOOP_NUDGE = `This step was not run. Nearly all of your last ${WINDOW} steps repeat steps you have already made ${REPEATS} or more times, so this run is going in circles. Do not make them again. Work from what you already have: write down your result now, or say plainly what is blocking you.`;
export const IMAGE_LIMIT = `This image was not opened. Only the last ${IMAGES_PER_STEP} images opened in one step reach you as pictures through this provider; any before them arrive as a line of text. Open it in your next step, and open at most ${IMAGES_PER_STEP} images per step.`;
export const LOOP_CLOSED = "Tools are closed for this run because it kept repeating the same steps. Reply now with your final report from what you already have, and say what is unfinished.";

// An agent that loops keeps its parent waiting and spends without limit. The first two times it is told so in place
// of the repeated step; a child agent that still goes on loses its tools and has to report. The agent the user talks
// to is only told, because the user can see it and stop it.
// OpenAI-format servers other than OpenAI's own (proxies in front of other models) pass on only the last two images
// of one step. An agent that does not see the pictures it asked for opens them again and again, so a third image in
// one step is refused with the reason.
export function registerLoopGuard(pi: ExtensionAPI) {
  const child = Number(process.env.NUCODE_SUBAGENT_DEPTH ?? 0) > 0;
  let watch = new LoopWatch(), closed = false, images = 0;
  pi.on("agent_start", () => { watch = new LoopWatch(); closed = false; });
  pi.on("turn_start", () => { images = 0; });
  pi.on("tool_call", (event, ctx) => {
    if (closed) return { block: true, reason: LOOP_CLOSED };
    if (imageRead(event.toolName, event.input) && ++images > IMAGES_PER_STEP && dropsImages(ctx?.model)) return { block: true, reason: IMAGE_LIMIT };
    if (!watch.push(stepSignature(event.toolName, event.input))) return;
    if (child && watch.hits >= CLOSE_AFTER) { closed = true; return { block: true, reason: LOOP_CLOSED }; }
    return { block: true, reason: LOOP_NUDGE };
  });
}

function dropsImages(model: { api?: string; baseUrl?: string } | undefined): boolean {
  if (!model?.api?.startsWith("openai-")) return false;
  if (!model.baseUrl) return false;
  try { return !/(^|\.)openai\.com$|\.openai\.azure\.com$/.test(new URL(model.baseUrl).hostname); } catch { return true; }
}
