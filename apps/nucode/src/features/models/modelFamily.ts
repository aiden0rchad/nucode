export type ModelFamily = "claude" | "openai" | "gemini" | "qwen" | "glm";

const FAMILIES: [ModelFamily, RegExp][] = [
  ["claude", /\b(claude|anthropic|opus|sonnet|haiku|fable)\b/i],
  ["openai", /\b(gpt|chatgpt|openai|codex|o[134](?:-mini|-pro)?)\b/i],
  ["gemini", /\b(gemini|google)\b/i],
  ["qwen", /\b(qwen\d*(?:\.\d+)?|qwq|tongyi|dashscope)\b/i],
  ["glm", /\b(glm|chatglm|zhipu|z-?ai|z\.ai|bigmodel)\b/i],
];

/**
 * Which provider a model belongs to, for its icon. The model's own name and id win over the provider,
 * so a Gemini model served through an OpenAI-compatible endpoint still reads as Gemini.
 */
export function modelFamily(model: { name?: string | null; id?: string | null; provider?: string | null } | null | undefined): ModelFamily | null {
  if (!model) return null;
  for (const source of [model.name, model.id, model.provider]) {
    const text = (source ?? "").replace(/[_/]/g, " ");
    const hit = FAMILIES.find(([, pattern]) => pattern.test(text));
    if (hit) return hit[0];
  }
  return null;
}
