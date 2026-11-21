import type { AppSettings, EngineDefinition } from "@/types";
import { useFeatureSettings } from "./features";
export const builtInEngines: EngineDefinition[] = [
  { id: "pi", name: "pi", protocol: "pi-rpc", builtIn: true, enabled: true },
  { id: "omp", name: "oh-my-pi", protocol: "pi-rpc", builtIn: true, enabled: false, description: "Bun runtime · LSP, debugger and Python/JS eval with approval · Install (~1.1 GB)" },
  { id: "codex", name: "Codex", protocol: "codex-app-server", builtIn: true, enabled: true },
  { id: "claude", name: "Claude Code (ACP)", protocol: "acp", builtIn: true, enabled: true },
  { id: "antigravity", name: "Antigravity", protocol: "acp", builtIn: true, enabled: false, description: "Google's agy CLI over ACP · uses your agy sign-in" },
  { id: "opencode", name: "OpenCode", protocol: "acp", builtIn: true, enabled: false, description: "OpenCode over ACP · uses your opencode sign-in and models" },
  { id: "cursor", name: "Cursor", protocol: "acp", builtIn: true, enabled: false, description: "Cursor's CLI over ACP · uses your cursor-agent sign-in" },
];
// These CLIs sign in on their own, bring their own models and are never installed or logged in by nucode.
export const ownLoginEngines = ["antigravity", "opencode", "cursor"];
export const isOwnLoginEngine = (id?: string | null) => !!id && ownLoginEngines.includes(id);
export const ownLoginHints: Record<string, string> = {
  antigravity: "Install Google's Antigravity CLI (`agy`), then run `agy` in Terminal to sign in.",
  opencode: "Install with `npm i -g opencode-ai`, then run `opencode auth login` in Terminal.",
  cursor: "Install the Cursor CLI from cursor.com/cli, then run `cursor-agent login` in Terminal.",
};
export function engineRegistry(settings?: Pick<AppSettings, "engines"> | null): EngineDefinition[] {
  return [...builtInEngines.map(engine => ({ ...engine, enabled: settings?.engines?.find(e => e.id === engine.id)?.enabled ?? engine.enabled })), ...(settings?.engines ?? []).filter(e => !builtInEngines.some(b => b.id === e.id))];
}
export function resolveEngine(id: string, settings?: AppSettings | null) {
  const registry = engineRegistry(settings);
  const engine = registry.find(e => e.id === id);
  const fallback = registry.find(e => e.id === settings?.agentPolicy?.defaultEngine && e.enabled) ?? registry.find(e => e.enabled) ?? builtInEngines[0];
  return { engine: engine ?? fallback, notice: engine ? undefined : `Unknown engine ${id}; using ${fallback.name}.` };
}
export function useEngines() { return engineRegistry(useFeatureSettings()); }
