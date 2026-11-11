import type { AppSettings, ProviderEntry } from "@/types";

export const contextSizeRange = { min: 8_000, max: 10_000_000 } as const;
export const autoCompactRange = { min: 50, max: 95 } as const;
export const contextSizeUsage = "Usage: /context-size <size> (for example 400k or 1m), or /context-size default.";
export const autoCompactUsage = "Usage: /autocompact <50-95>, /autocompact on, or /autocompact off.";

/** 33000 -> "33k", 1500 -> "1.5k", 1_200_000 -> "1.2m"; null/undefined -> "—". */
export function formatK(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const trim = (n: number, unit: string) => `${n.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (value >= 1_000_000) return trim(value / 1_000_000, "m");
  if (value >= 1000) return trim(value / 1000, "k");
  return String(Math.round(value));
}

/** "200000", "200k", "1m", "1.5m" (case-insensitive) -> tokens, or null when malformed or out of range. */
export function parseContextSize(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(text.trim());
  if (!match) return null;
  const size = Math.round(Number(match[1]) * ({ k: 1000, m: 1_000_000 } as Record<string, number>)[match[2]?.toLowerCase() ?? ""] || Number(match[1]));
  return size >= contextSizeRange.min && size <= contextSizeRange.max ? size : null;
}

export type AutoCompactSetting = NonNullable<AppSettings["autoCompact"]>;

/** "80" or "80%" -> percent, "on"/"off" -> enabled; "" -> report; anything else is invalid. */
export function parseAutoCompact(text: string): { type: "report" } | { type: "off" } | { type: "on" } | { type: "percent"; percent: number } | { type: "invalid" } {
  const arg = text.trim().toLowerCase();
  if (!arg) return { type: "report" };
  if (arg === "on" || arg === "off") return { type: arg };
  const match = /^(\d{1,3})\s*%?$/.exec(arg);
  const percent = match ? Number(match[1]) : NaN;
  return percent >= autoCompactRange.min && percent <= autoCompactRange.max ? { type: "percent", percent } : { type: "invalid" };
}

export function describeAutoCompact(setting: AutoCompactSetting | undefined) {
  if (setting && !setting.enabled) return "Auto-compact is off.";
  return setting?.percent ? `Auto-compact at ${setting.percent}% of the context window.` : "Auto-compact is on at the default threshold.";
}

export type ContextCommandEnv = {
  providers: ProviderEntry[];
  autoCompact: AutoCompactSetting | undefined;
  /** The model the active thread sends with, as the registry knows it. */
  model: { providerId: string; modelId: string; name: string } | null;
  save: (patch: Partial<AppSettings>) => Promise<void>;
};

/** Runs /context-size or /autocompact and returns the one-line reply. */
export async function runContextCommand(text: string, env: ContextCommandEnv): Promise<string> {
  const match = /^\/(context-size|autocompact)\b\s*(.*)$/is.exec(text.trim());
  if (!match) return contextSizeUsage;
  const arg = match[2].trim();
  if (match[1].toLowerCase() === "autocompact") {
    const action = parseAutoCompact(arg);
    if (action.type === "invalid") return autoCompactUsage;
    if (action.type === "report") return describeAutoCompact(env.autoCompact);
    const next: AutoCompactSetting = action.type === "off" ? { ...env.autoCompact, enabled: false }
      : action.type === "on" ? { ...env.autoCompact, enabled: true }
      : { enabled: true, percent: action.percent };
    await env.save({ autoCompact: next });
    return `${describeAutoCompact(next)} Applies from the next turn.`;
  }
  if (!arg) return contextSizeUsage;
  const model = env.model;
  if (!model) return "Select a model first.";
  const size = arg.toLowerCase() === "default" ? null : parseContextSize(arg);
  if (arg.toLowerCase() !== "default" && size === null) return contextSizeUsage;
  const entry = env.providers.find(provider => provider.id === model.providerId)?.models.find(candidate => candidate.id === model.modelId);
  if (!entry) return `${model.name} is not in your providers, so its context size cannot be set.`;
  const previous = entry.contextWindow ?? null;
  await env.save({ providers: env.providers.map(provider => provider.id !== model.providerId ? provider : { ...provider, models: provider.models.map(candidate => candidate.id === model.modelId ? { ...candidate, contextWindow: size } : candidate) }) });
  return `Context size for ${model.name} ${size === null ? "reset to the default" : `set to ${formatK(size)}`} (was ${previous === null ? "the default" : formatK(previous)}). Applies from the next turn.`;
}
