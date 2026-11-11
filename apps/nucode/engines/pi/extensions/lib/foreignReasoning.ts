type Block = { type?: string };
type Message = { role?: string; provider?: string; model?: string; content?: unknown };
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
