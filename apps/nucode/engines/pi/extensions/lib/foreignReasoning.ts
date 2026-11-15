type Block = { type?: string };
type Message = { role?: string; provider?: string; model?: string; content?: unknown; timestamp?: number; historyRewriteAt?: number; prunedAt?: number; stopReason?: string; errorMessage?: string };
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
  return withoutReasoning(messages, message => message.model !== target.id || message.provider !== target.provider);
}

/** When this message says the history before it was rewritten, or undefined. */
function rewrittenAt(message: Message): number | undefined {
  // A summary took the place of older turns.
  if (message.role === "compactionSummary") return message.historyRewriteAt ?? message.timestamp;
  if (message.role === "user") return message.historyRewriteAt;
  // The output of an old tool call was cut down to save room.
  if (message.role === "toolResult") return message.prunedAt;
  return undefined;
}

/** The provider refused the whole history without writing anything: something before this turn no longer matches. */
function refused(message: Message): boolean {
  const empty = !Array.isArray(message.content) || message.content.length === 0;
  return message.role === "assistant" && message.stopReason === "error" && empty && /content[_ ]filter/i.test(message.errorMessage ?? "");
}

/**
 * Removes reasoning written before the history ahead of it was last rewritten.
 *
 * Claude models tie each reasoning block to the conversation that came before it. When the engine summarises a long
 * history or cuts down old tool output, the turns it keeps still carry reasoning tied to the old text. The provider
 * rejects such a request before writing anything, a proxy reports that as a content filter stop, and every retry
 * fails the same way. Reasoning written after the rewrite is tied to the new text and stays. A refusal already in the
 * history is read the same way, whatever caused it: the reasoning before it goes, so the next try can pass.
 *
 * Returns the new list, or undefined when nothing changed.
 */
export function dropStaleReasoning<T extends Message>(messages: T[]): T[] | undefined {
  const lastRefusal = messages.findLast(refused);
  let latest: number | undefined;
  const stale = new Set<Message>();
  for (const [index, message] of messages.entries()) {
    const at = rewrittenAt(message);
    if (at !== undefined) latest = latest === undefined ? at : Math.max(latest, at);
    else if (message.role !== "assistant") continue;
    else if (latest !== undefined && (message.timestamp ?? 0) <= latest) stale.add(message);
    else if (lastRefusal && index < messages.indexOf(lastRefusal)) stale.add(message);
  }
  return stale.size ? withoutReasoning(messages, message => stale.has(message)) : undefined;
}

function withoutReasoning<T extends Message>(messages: T[], drop: (message: T) => boolean): T[] | undefined {
  let changed = false;
  const kept: T[] = [];
  for (const message of messages) {
    const foreign = message.role === "assistant" && drop(message);
    if (!foreign || !Array.isArray(message.content)) { kept.push(message); continue; }
    const content = (message.content as Block[]).filter(block => !REASONING.has(block?.type ?? ""));
    if (content.length === message.content.length) { kept.push(message); continue; }
    changed = true;
    // A turn that held nothing but reasoning has no answer or tool call to keep.
    if (content.length > 0) kept.push({ ...message, content });
  }
  return changed ? kept : undefined;
}
