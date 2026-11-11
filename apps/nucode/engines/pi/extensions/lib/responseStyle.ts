export type ResponseStyle = "concise" | "standard" | "detailed";

const HEADING = "# How to work and report";
const CONCISE_RULE = /^- Be concise in your responses\.?[ \t]*\r?\n?/m;

const SECTIONS: Record<ResponseStyle, string> = {
  concise: `${HEADING}

- Be concise in your responses.`,
  standard: `${HEADING}

- Keep working until the request is fully handled. When a step fails or a result looks incomplete, try the next reasonable approach yourself instead of stopping to report it. Stop only when the work is done or you need a decision or information that only the user can give.
- Before you finish, check your work against what was asked: run it, test it or re-read it.
- Make the final reply as long as the work needs. Say what you did, what you found and anything the user should check or decide. Do not pad it and do not cut it short.`,
  detailed: `${HEADING}

- Be thorough. Investigate before you conclude: read the relevant code or sources, consider more than one explanation or approach, and follow up on anything that looks off.
- Keep working until the request is fully handled. When a step fails or a result looks incomplete, try the next reasonable approach yourself instead of stopping to report it. Stop only when the work is done or you need a decision or information that only the user can give.
- Verify results before you report them, and say how you verified them.
- Write a complete final reply: what you did and why, what you found with the evidence, the trade-offs you weighed, and what is still open or risky. Prefer a full explanation to a short one.`,
};

/** Anything that is not a known style is "standard". */
export function parseResponseStyle(value: string | undefined): ResponseStyle {
  return value === "concise" || value === "detailed" ? value : "standard";
}

const headingIndex = (text: string): number => {
  if (text.startsWith(`${HEADING}\n`) || text === HEADING || text.startsWith(`${HEADING}\r\n`)) return 0;
  const at = text.search(/\n# How to work and report[ \t]*\r?(\n|$)/);
  return at < 0 ? -1 : at + 1;
};

const withSection = (text: string, section: string): string => {
  const at = headingIndex(text);
  if (at >= 0) return text.slice(0, at) + section;
  const head = text.trimEnd();
  return head ? `${head}\n\n${section}` : section;
};

/** Returns the prompt to use, in the same shape it was given (string for pi, string[] for omp). */
export function applyResponseStyle<T extends string | string[]>(prompt: T, style: ResponseStyle): T {
  const section = SECTIONS[style];
  const strip = (text: string) => text.replace(CONCISE_RULE, "");
  if (Array.isArray(prompt)) {
    if (style === "concise" && prompt.some(part => CONCISE_RULE.test(part))) return prompt;
    const parts = style === "concise" ? [...prompt] : prompt.map(strip);
    const own = parts.findIndex(part => headingIndex(part) === 0);
    if (own >= 0) parts[own] = section;
    else parts.push(section);
    return parts as T;
  }
  const text = prompt as string;
  if (style === "concise" && CONCISE_RULE.test(text)) return prompt;
  return withSection(style === "concise" ? text : strip(text), section) as T;
}
