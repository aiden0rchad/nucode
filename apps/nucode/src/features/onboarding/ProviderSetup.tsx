import { useEffect, useState } from "react";
import { Cloud, Cpu, KeyRound, Network, Sparkles, Waypoints } from "lucide-react";
import type { AppSettings, ProviderEntry, ProviderKind } from "@/types";
import { providerHasApiKey, providerSetApiKey, providerTestAndFetch } from "@services/tauri";
import { defaultAgentPolicy, providerSlug } from "@settings/registry";
import { SettingsButton, SettingsTextField } from "@/features/design-system/components/settings/SettingsPrimitives";

import { SetupStatusChip } from "./SetupStatusChip";
import { SetupModelPicker } from "./SetupModelPicker";

type Save = (change: (settings: AppSettings) => AppSettings) => Promise<AppSettings>;
const choices = [
  { kind: "openai", name: "OpenAI", description: "GPT models for everyday work", Icon: Sparkles },
  { kind: "anthropic", name: "Anthropic", description: "Build and reason with Claude", Icon: Cloud },
  { kind: "openrouter", name: "OpenRouter", description: "Many models, one connection", Icon: Waypoints },
  { kind: "google", name: "Google", description: "Explore with Gemini", Icon: Sparkles },
  { kind: "ollama", name: "Local", description: "Ollama / LM Studio · no key", Icon: Cpu },
  { kind: "openai-compatible", name: "OpenAI-compatible", description: "LiteLLM, vLLM, and more", Icon: Network },
] satisfies { kind: ProviderKind; name: string; description: string; Icon: typeof Cloud }[];

export function useSetupProvider(settings: AppSettings | null, save: Save, open: boolean) {
  const [draft, setDraft] = useState<ProviderEntry | null>(null);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [connected, setConnected] = useState(false);
  const [model, setModel] = useState("");
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!open) { setDraft(null); setKey(""); setConnected(false); setAdding(false); }
  }, [open]);
  useEffect(() => {
    let active = true;
    setKey(""); setHasKey(false);
    if (draft?.id && draft.auth.type === "apiKey") void providerHasApiKey(draft.id).then(value => { if (active) setHasKey(value); }).catch(() => {});
    return () => { active = false; };
  }, [draft?.id, draft?.auth.type]);
  useEffect(() => {
    if (!open || draft || adding || !settings?.providers?.length) return;
    const selected = settings.providers.find(p => p.id === settings.agentPolicy?.defaultModel?.providerId) ?? settings.providers[0];
    setDraft(selected);
    setModel(settings.agentPolicy?.defaultModel?.modelId ?? selected.models.find(m => m.enabled)?.id ?? "");
  }, [settings, draft, adding, open]);
  const choose = (p: ProviderEntry) => { setDraft(p); setConnected(false); setKey(""); setModel(p.models.find(m => m.enabled)?.id ?? ""); };
  const submit = async () => {
    if (!draft) throw new Error("Choose a provider.");
    if (connected) {
      if (!draft.models.some(m => m.id === model && m.enabled)) throw new Error("Choose a default model.");
      // Model on/off choices and the default are saved together.
      await save(s => ({ ...s, providers: (s.providers ?? []).map(p => p.id === draft.id ? { ...p, models: draft.models } : p), agentPolicy: { ...(s.agentPolicy ?? defaultAgentPolicy), defaultModel: { providerId: draft.id, modelId: model } } }));
      return true;
    }
    if (!draft.name.trim()) throw new Error("Enter a provider name.");
    if (draft.baseUrl) {
      const url = new URL(draft.baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP or HTTPS URL without credentials.");
    }
    if (draft.auth.type === "apiKey" && !key && !hasKey) throw new Error("Enter an API key.");
    let provider = { ...draft, name: draft.name.trim(), enabled: true };
    await save(s => {
      if (!draft.id) provider = { ...provider, id: providerSlug(provider.name, s.providers ?? []) };
      return { ...s, providers: [...(s.providers ?? []).filter(p => p.id !== provider.id), provider] };
    });
    setDraft(provider);
    if (key) {
      // Credentials never enter settings, progress storage, or error messages.
      try { await providerSetApiKey(provider.id, key); setHasKey(true); }
      catch { throw new Error("Could not save the API key to Keychain. Please try again."); }
      finally { setKey(""); }
    }
    const redact = (message: string) => key ? message.split(key).join("[redacted]") : message;
    const result = await providerTestAndFetch(provider.id).catch(error => { throw new Error(redact(String(error))); });
    if (!result.ok) throw new Error(redact(result.error || "Connection failed. Check your provider settings."));
    const updated = { ...provider, models: result.models, modelsFetchedAt: Math.floor(Date.now() / 1000) };
    await save(s => ({ ...s, providers: (s.providers ?? []).map(p => p.id === updated.id ? updated : p) }));
    setDraft(updated); setConnected(true);
    setModel(result.models.some(m => m.id === model && m.enabled) ? model : result.models.find(m => m.enabled)?.id ?? "");
    return false;
  };
  const fields = <>
    {!!settings?.providers?.length && !adding && <>
      <div className="setup-cards setup-provider-grid" data-card-grid>{settings.providers.map(p => <button type="button" className="setup-card" aria-label={p.name} aria-pressed={draft?.id === p.id} key={p.id} onClick={() => choose(p)}><KeyRound size={20} /><strong>{p.name}</strong><small>Already configured · Use this</small></button>)}</div>
      <SettingsButton className="ghost" onClick={() => { setAdding(true); setDraft(null); setConnected(false); setKey(""); }}>Add another</SettingsButton>
    </>}
    {(!settings?.providers?.length || adding) && <div className="setup-cards setup-provider-grid" data-card-grid>{choices.map(({ kind, name, description, Icon }) => <button type="button" className="setup-card" aria-label={name} aria-pressed={draft?.kind === kind} key={kind} onClick={() => choose({ id: "", kind, name, enabled: true, models: [], auth: { type: kind === "ollama" ? "none" : "apiKey" }, baseUrl: kind === "ollama" ? "http://localhost:11434/v1" : kind === "openai-compatible" ? "http://localhost:8000/v1" : null, apiStyle: kind === "openai-compatible" ? "chat-completions" : null })}><Icon size={20} /><strong>{name}</strong><small>{description}</small></button>)}</div>}
    {draft && !connected && <div className="setup-reveal" key={draft.id}><div className="setup-fields">
      <label>Name<SettingsTextField required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      {["ollama", "lmstudio", "openai-compatible"].includes(draft.kind) && <label>Base URL<SettingsTextField type="url" required value={draft.baseUrl ?? ""} onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} /></label>}
      {draft.auth.type === "apiKey" && <label>API key<SettingsTextField type="password" autoComplete="new-password" placeholder={hasKey ? "Saved in Keychain" : "Enter your API key"} value={key} onChange={e => setKey(e.target.value)} /></label>}
    </div></div>}
    {connected && draft && <section className="setup-models" aria-labelledby="setup-models-title">
      <header className="setup-models-head"><h2 id="setup-models-title">Models</h2><span className="setup-connected"><SetupStatusChip state="connected">✓ Connected · {draft.models.length} models</SetupStatusChip></span></header>
      {draft.models.length ? <SetupModelPicker models={draft.models} defaultId={model} onModels={models => setDraft({ ...draft, models })} onDefault={setModel} /> : <p className="setup-hint">No models returned. Add a model in Settings → Providers, or skip for now.</p>}
    </section>}
    {!connected && <p className="setup-hint">You'll need a provider before your first conversation.</p>}
  </>;
  return { fields, submit, connected, valid: !!draft && (connected ? !!model : !!draft.name.trim() && (draft.auth.type !== "apiKey" || !!key || hasKey)), clearKey: () => setKey("") };
}
