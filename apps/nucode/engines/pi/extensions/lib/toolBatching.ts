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
