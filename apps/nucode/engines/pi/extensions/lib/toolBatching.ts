import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// Recorded nucode runs make one tool call in four of five model turns, and every turn re-sends the whole
// conversation (about 150k tokens deep into a long task). A third of those turns only read or search, often the
// next part of a file already open. Asking for independent lookups together cuts turns, time and tokens.
const HEADING = "# Tool calls";
export const TOOL_BATCHING = `${HEADING}

- When you already know several files, line ranges or searches you will need, ask for all of them in one response as parallel tool calls, not one per turn. Every turn re-sends the whole conversation, so three reads in one turn cost about a third of three turns.
- Read all of the range you need at once rather than in consecutive pieces, and do not read again what is still in the conversation unless the file changed since.
- Keep calls one per turn only when the next one depends on what the last one returned.`;

/** Adds the section once, in the same shape the prompt was given (string for pi, string[] for omp). */
export function applyToolBatching<T extends string | string[]>(prompt: T): T {
  if (Array.isArray(prompt)) return (prompt.some(part => part.startsWith(HEADING)) ? prompt : [...prompt, TOOL_BATCHING]) as T;
  const text = prompt as string;
  if (text.includes(`\n${HEADING}\n`) || text.startsWith(`${HEADING}\n`)) return prompt;
  const head = text.trimEnd();
  return (head ? `${head}\n\n${TOOL_BATCHING}` : TOOL_BATCHING) as T;
}

// The prompt alone did not change much: in one recorded phase 57% of steps made a single lookup, and a third of
// steps were a lookup the agent could have asked for together with the one before. A short reminder right after a
// run of single lookups reaches the model when the next lookups are being chosen.
const LOOKUPS = new Set(["read", "grep", "glob", "find", "ls"]);
export const STREAK = 3, COOLDOWN = 10;
export const BATCH_NUDGE = `Your last ${STREAK} steps each made one lookup. If you already know further files, line ranges or searches you need, request them together in your next step as parallel tool calls.`;

/** Counts steps that made exactly one lookup in a row, and says when to remind, at most once per COOLDOWN steps. */
export class LookupStreak {
  private streak = 0;
  private quiet = 0;
  private calls: string[] = [];
  start() { this.calls = []; }
  call(tool: string) { this.calls.push(tool); }
  /** Call when a step's tools have all run; true means remind now. */
  end(): boolean {
    const single = this.calls.length === 1 && LOOKUPS.has(this.calls[0]);
    this.streak = single ? this.streak + 1 : 0;
    if (this.quiet > 0) this.quiet--;
    if (this.streak < STREAK || this.quiet > 0) return false;
    this.streak = 0; this.quiet = COOLDOWN;
    return true;
  }
}

export function registerBatchNudge(pi: ExtensionAPI) {
  let watch = new LookupStreak(), pending = 0;
  pi.on("agent_start", () => { watch = new LookupStreak(); });
  pi.on("turn_start", () => { watch.start(); pending = 0; });
  pi.on("tool_call", event => { watch.call(event.toolName); pending++; });
  pi.on("tool_result", () => {
    // The last result of the step decides; the reminder rides along with it to the next request.
    if (--pending > 0) return;
    pending = 0;
    if (watch.end()) return { additionalContext: BATCH_NUDGE } as any;
  });
}
