import type { AppSettings, ProviderEntry, ProviderModel } from "@/types";

export const contextSizeRange = { min: 8_000, max: 10_000_000 } as const;
/** The smallest auto-compact point; the largest is just below the model's window. */
export const compactAtMin = 1_000;
/** The window nucode assumes for a model with no context size set. */
export const defaultContextWindow = 128_000;
export const contextSizeUsage = "Usage: /maxcontext <size> (for example 500k or 1m), or /maxcontext default.";
export const autoCompactUsage = "Usage: /autocompact <tokens> (for example 290k), /autocompact default, /autocompact on, or /autocompact off.";
// The engine reads model settings when it starts; nucode restarts it on the thread's next message and resumes the same session.
const takesEffect = "Takes effect on your next message; this conversation carries on.";

/** 33000 -> "33k", 1500 -> "1.5k", 1_200_000 -> "1.2m"; null/undefined -> "—". */
export function formatK(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const trim = (n: number, unit: string) => `${n.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (value >= 1_000_000) return trim(value / 1_000_000, "m");
  if (value >= 1000) return trim(value / 1000, "k");
  return String(Math.round(value));
}

/** "200000", "200k", "1m", "1.5m" (case-insensitive) -> tokens, or null when malformed. */
export function parseTokens(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(text.trim());
  if (!match) return null;
  const scale = match[2] ? (match[2].toLowerCase() === "m" ? 1_000_000 : 1000) : 1;
  return Math.round(Number(match[1]) * scale);
}

/** A context window in tokens, or null when malformed or out of range. */
export function parseContextSize(text: string): number | null {
  const size = parseTokens(text);
  return size !== null && size >= contextSizeRange.min && size <= contextSizeRange.max ? size : null;
}

export type AutoCompactSetting = NonNullable<AppSettings["autoCompact"]>;
export type AutoCompactAction = { type: "report" } | { type: "off" } | { type: "on" } | { type: "default" } | { type: "tokens"; tokens: number } | { type: "invalid" };

/** "290k" -> a token threshold, "on"/"off"/"default" -> those; "" -> report; anything else (a percentage included) is invalid. */
export function parseAutoCompact(text: string): AutoCompactAction {
  const arg = text.trim().toLowerCase();
  if (!arg) return { type: "report" };
  if (arg === "on" || arg === "off" || arg === "default") return { type: arg };
  const tokens = parseTokens(arg);
  return tokens !== null && tokens >= compactAtMin ? { type: "tokens", tokens } : { type: "invalid" };
}

export const windowOf = (model: Pick<ProviderModel, "contextWindow">) => model.contextWindow ?? defaultContextWindow;

/** Why `tokens` cannot be the auto-compact point of a `window`-token model, or null when it can. */
export function compactAtError(tokens: number, window: number, name: string): string | null {
  if (tokens < compactAtMin) return autoCompactUsage;
  if (tokens >= window) return `${formatK(tokens)} is not below the ${formatK(window)} context window of ${name}. Pick a smaller point, or raise the window with /maxcontext.`;
  return null;
}

export function describeAutoCompact(setting: AutoCompactSetting | undefined, model?: { entry: ProviderModel; name: string }) {
  if (setting && !setting.enabled) return "Auto-compact is off.";
  if (model?.entry.compactAt) return `${model.name} auto-compacts at ${formatK(model.entry.compactAt)} of its ${formatK(windowOf(model.entry))} context window.`;
  return setting?.percent ? `Auto-compact at ${setting.percent}% of the context window.` : "Auto-compact is on at the default threshold.";
}

export type ContextCommandEnv = {
  providers: ProviderEntry[];
  autoCompact: AutoCompactSetting | undefined;
  /** The model the active thread sends with, as the registry knows it. */
  model: { providerId: string; modelId: string; name: string } | null;
  save: (patch: Partial<AppSettings>) => Promise<void>;
};

/** Runs /maxcontext (or its older name /context-size) or /autocompact and returns the one-line reply. */
export async function runContextCommand(text: string, env: ContextCommandEnv): Promise<string> {
  const match = /^\/(maxcontext|context-size|autocompact)\b\s*(.*)$/is.exec(text.trim());
  if (!match) return contextSizeUsage;
  const arg = match[2].trim();
  const model = env.model;
  const entry = model ? env.providers.find(provider => provider.id === model.providerId)?.models.find(candidate => candidate.id === model.modelId) : undefined;
  const updateModel = (patch: Partial<ProviderModel>, autoCompact?: AutoCompactSetting) => env.save({
    providers: env.providers.map(provider => provider.id !== model!.providerId ? provider : { ...provider, models: provider.models.map(candidate => candidate.id === model!.modelId ? { ...candidate, ...patch } : candidate) }),
    ...(autoCompact ? { autoCompact } : {}),
  });
  const notInProviders = () => `${model!.name} is not in your providers, so its context settings cannot be changed.`;

  if (match[1].toLowerCase() === "autocompact") {
    const action = parseAutoCompact(arg);
    if (action.type === "invalid") return autoCompactUsage;
    if (action.type === "report") return describeAutoCompact(env.autoCompact, model && entry ? { entry, name: model.name } : undefined);
    if (action.type === "on" || action.type === "off") {
      await env.save({ autoCompact: { ...env.autoCompact, enabled: action.type === "on" } });
      return `Auto-compact is ${action.type}. ${takesEffect}`;
    }
    if (!model) return "Select a model first.";
    if (!entry) return notInProviders();
    const window = windowOf(entry);
    if (action.type === "default") {
      await updateModel({ compactAt: null });
      return `${model.name} auto-compacts at the default threshold of its ${formatK(window)} context window. ${takesEffect}`;
    }
    const error = compactAtError(action.tokens, window, model.name);
    if (error) return error;
    // Setting a point means the user wants compaction, so it also turns auto-compact back on.
    await updateModel({ compactAt: action.tokens }, env.autoCompact && !env.autoCompact.enabled ? { ...env.autoCompact, enabled: true } : undefined);
    return `${model.name} auto-compacts at ${formatK(action.tokens)} of its ${formatK(window)} context window. ${takesEffect}`;
  }

  if (!arg) return contextSizeUsage;
  if (!model) return "Select a model first.";
  const isDefault = arg.toLowerCase() === "default";
  const size = isDefault ? null : parseContextSize(arg);
  if (!isDefault && size === null) return contextSizeUsage;
  if (!entry) return notInProviders();
  if (entry.compactAt && entry.compactAt >= (size ?? defaultContextWindow)) {
    return `${model.name} auto-compacts at ${formatK(entry.compactAt)}, so its context window must stay above that. Lower the point first with /autocompact, or use /autocompact default.`;
  }
  const previous = entry.contextWindow ?? null;
  await updateModel({ contextWindow: size });
  return `Context window for ${model.name} ${size === null ? `reset to the default (${formatK(defaultContextWindow)})` : `set to ${formatK(size)}`} (was ${previous === null ? "the default" : formatK(previous)}). ${takesEffect}`;
}
