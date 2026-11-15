type Block = { type?: string };
type Message = { role?: string; provider?: string; model?: string; content?: unknown; historyRewriteAt?: number };
type Target = { provider?: string; id?: string } | undefined;

const REASONING = new Set(["thinking", "redactedThinking"]);

/**
 * Removes reasoning blocks written by a model other than the one about to answer.
 *
 * After a model switch the engines replay the earlier model's reasoning as plain text in the history. Models reached
 * through a proxy are named freely, so the engine cannot tell which text form is safe for the target and falls back to
 * `<thinking>` tags. Claude models decline such requests (their provider reads replayed reasoning as an attempt to
 * extract it), and the thread stays stuck. The earlier model's answers and tool calls are kept; only its reasoning
 * goes. A model's own reasoning is left for the engine to replay natively.
 *
 * Returns the new list, or undefined when nothing changed.
 */
export function dropForeignReasoning<T extends Message>(messages: T[], target: Target): T[] | undefined {
  if (!target?.id) return undefined;
  let changed = false;
  const kept: T[] = [];
  for (const message of messages) {
    const foreign = message.role === "assistant" && (message.model !== target.id || message.provider !== target.provider);
    if (!foreign || !Array.isArray(message.content)) { kept.push(message); continue; }
    const content = (message.content as Block[]).filter(block => !REASONING.has(block?.type ?? ""));
    if (content.length === message.content.length) { kept.push(message); continue; }
    changed = true;
    // A turn that held nothing but reasoning has no answer or tool call to keep.
    if (content.length > 0) kept.push({ ...message, content });
  }
  return changed ? kept : undefined;
}

// omp writes archived turns as text, one section per speaker, each opened by a label at the start of a line. A line
// break is "\n" or the block glyph omp stores in its place. Tool output sits between the marks below, and a label
// inside it is output, not a section.
const SECTION = /(?<=^|[\n\u2588])(?=¶(?:user|think|ai|call):)/;
const OUTPUT_MARKS: [string, string][] = [["\u000e", "\u000f"], ["<out>", "</out>"]];

/** Archive text without its `¶think:` sections: each label line and the lines after it, up to the next label. */
export function withoutArchivedReasoning(text: string): string {
  if (!text.includes("¶think:")) return text;
  const sections: string[] = [];
  let inOutput = false;
  for (const piece of text.split(SECTION)) {
    if (inOutput) sections[sections.length - 1] += piece;
    else sections.push(piece);
    for (const [open, close] of OUTPUT_MARKS) {
      const on = piece.lastIndexOf(open), off = piece.lastIndexOf(close);
      if (on !== off) inOutput = on > off;
    }
  }
  const kept = sections.filter(section => !section.startsWith("¶think:"));
  if (kept.length === sections.length) return text;
  const joined = kept.join("");
  return sections.at(-1)?.startsWith("¶think:") ? joined.replace(/[\n\u2588]+$/, "") : joined;
}

type Archive = Message & { summary?: unknown; blocks?: unknown };

/**
 * Removes the model's reasoning from the archive omp keeps of older turns.
 *
 * When a history grows too long omp replaces its older turns with a text archive of them, reasoning included, and
 * sends that archive with every later request. Claude models refuse a request that quotes reasoning back to them:
 * the provider answers with nothing, a proxy reports a content filter stop, and every retry fails the same way, so a
 * long agent run dies at the moment its history is first shortened. omp leaves the reasoning out for model names it
 * knows; models reached through a proxy are named freely and get no such care.
 *
 * Returns the new list, or undefined when nothing changed.
 */
export function dropArchivedReasoning<T extends Message>(messages: T[]): T[] | undefined {
  let changed = false;
  const out = messages.map(message => {
    const archive = message as Archive;
    if (message.role !== "compactionSummary" && !(message.role === "user" && message.historyRewriteAt !== undefined)) return message;
    const next: Record<string, unknown> = {};
    for (const key of ["summary", "content", "blocks"] as const) {
      const value = archive[key];
      if (typeof value === "string") { const text = withoutArchivedReasoning(value); if (text !== value) next[key] = text; }
      else if (Array.isArray(value)) {
        const parts = value.map((part: { type?: string; text?: string }) => part?.type === "text" && typeof part.text === "string" && withoutArchivedReasoning(part.text) !== part.text ? { ...part, text: withoutArchivedReasoning(part.text) } : part);
        if (parts.some((part, index) => part !== value[index])) next[key] = parts;
      }
    }
    if (!Object.keys(next).length) return message;
    changed = true;
    return { ...message, ...next };
  });
  return changed ? out : undefined;
}
