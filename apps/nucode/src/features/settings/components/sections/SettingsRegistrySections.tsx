import { useEngines } from "@settings/engines";
import { SettingsCallout, SettingsEmpty, SettingsListRow, SettingsPage, SettingsRow, SettingsRowText, SettingsStatus, SettingsUnsaved, SettingsDisclosureRow, SettingsDisabled, SettingsButton, SettingsTextField, SettingsSelect, SettingsNumberStepper, SettingsTextArea, SettingsGroup, SettingsFieldRow, SettingsToggleRow, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { RowMenu } from "@/features/chat/RowMenu";
import { formatRelativeTimeShort } from "@utils/time";
import { ModelReasoningSettings } from "./ModelReasoningSettings";
import { ExecutionLimits } from "./ExecutionLimits";
import { useEffect, useState, type ReactNode } from "react";
import type { AppSettings, ProviderEntry, ProviderKind, ProviderAuth, AgentPolicy, WorkspaceInfo, WorkspaceSettings } from "@/types";
import { providerSetApiKey, providerHasApiKey, providerDeleteApiKey, providerTestAndFetch } from "@services/tauri";
import { commandRoles, commandRoleTitle, defaultAgentPolicy, isCommandRole, mergePolicy, modelKey, modelRef, policyError, providerEngines, setAgentMode } from "../../registry";

type Props = { appSettings: AppSettings; onUpdateAppSettings: (s: AppSettings) => Promise<void> };
const kinds: ProviderKind[] = ["openai", "anthropic", "google", "openrouter", "groq", "mistral", "xai", "deepseek", "zai", "ollama", "lmstudio", "openai-compatible"];
const newProvider = (): ProviderEntry => ({ id: "", name: "", kind: "openai", auth: { type: "apiKey" }, enabled: true, models: [] });

export function SettingsProvidersSection({ appSettings, onUpdateAppSettings }: Props) {
  const providers = appSettings.providers ?? [];
  const [deleting, setDeleting] = useState<string | null>(null);
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<ProviderEntry | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setKey(""); setHasKey(false);
    if (editing) void providerHasApiKey(editing).then(value => { if (active) setHasKey(value); }).catch(() => {});
    return () => { active = false; };
  }, [editing]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const save = async (p: ProviderEntry) => {
    const next = editing ? providers.map(v => v.id === editing ? p : v) : [...providers, p];
    await onUpdateAppSettings({ ...appSettings, providers: next });
    if (key) { await providerSetApiKey(p.id, key); setKey(""); setHasKey(true); }
    setEditing(p.id);
  };
  const auth = (type: ProviderAuth["type"]): ProviderAuth => type === "env" ? { type, var: "" } : type === "command" ? { type, command: "", args: [] } : { type };
  const providerStatus = (p: ProviderEntry) => testErrors[p.id]
    ? { tone: "error" as const, label: "Failed" }
    : p.modelsFetchedAt ? { tone: "ready" as const, label: "Ready" } : { tone: "idle" as const, label: "Not tested" };
  const test = (p: ProviderEntry) => void run(async () => {
    setTestErrors(previous => ({ ...previous, [p.id]: "" }));
    try {
      const result = await providerTestAndFetch(p.id);
      if (!result.ok) throw new Error(result.error);
      await onUpdateAppSettings({ ...appSettings, providers: providers.map(v => v.id === p.id ? { ...v, models: result.models, modelsFetchedAt: Math.floor(Date.now() / 1000) } : v) });
    } catch (error) { setTestErrors(previous => ({ ...previous, [p.id]: String(error) })); }
  });
  return <SettingsPage title="Providers" subtitle="Use your own API keys or local models."><SettingsGroup title="Your providers" subtitle="Providers that are on supply the models you can pick; turn one off to hide them." actions={<SettingsButton type="button" disabled={busy} onClick={() => { setDraft(newProvider()); setEditing(null); setStatus(""); }}><Plus aria-hidden />Add provider</SettingsButton>}>
    {error && <SettingsCallout tone="error">{error}</SettingsCallout>}
    {providers.map(p => { const state = providerStatus(p); return <div key={p.id} className="settings-list-group" role="group" aria-label={`${p.name} provider`}>
      <SettingsListRow className={p.enabled ? undefined : "is-off"} icon={p.name.slice(0, 1).toUpperCase()} title={p.name}
        meta={<><SettingsStatus tone={state.tone} role={testErrors[p.id] ? "alert" : "status"} title={testErrors[p.id] || undefined}>{testErrors[p.id] || state.label}</SettingsStatus><span>{p.kind}</span><span>{p.baseUrl || "Default endpoint"}</span><span>{p.models.length} models{p.modelsFetchedAt ? ` · tested ${Date.now() / 1000 - p.modelsFetchedAt < 60 ? "just now" : formatRelativeTimeShort(p.modelsFetchedAt * 1000) + " ago"}` : ""}</span></>}>
        {p.enabled && state.tone !== "ready" && <SettingsButton type="button" aria-label={`Test ${p.name}`} disabled={busy} onClick={() => test(p)}>Test</SettingsButton>}
        <SettingsToggleSwitch aria-label={`Enable ${p.name}`} pressed={p.enabled} disabled={busy} onClick={() => void run(() => onUpdateAppSettings({ ...appSettings, providers: providers.map(v => v.id === p.id ? { ...v, enabled: !p.enabled } : v) }))} />
        <RowMenu portal size="md" label={p.name} actions={[
          { label: "Test & fetch models", icon: <RefreshCw size={14} />, disabled: busy, onClick: () => test(p) },
          { label: "Edit", icon: <Pencil size={14} />, disabled: busy, onClick: () => { setDraft(structuredClone(p)); setEditing(p.id); setStatus(""); } },
          { label: "Delete", icon: <Trash2 size={14} />, danger: true, disabled: busy, onClick: () => setDeleting(p.id) },
        ]}>{null}</RowMenu>
      </SettingsListRow>
      {deleting === p.id && <SettingsRow className="provider-delete-confirm" role="alertdialog" aria-label={`Delete ${p.name}?`}><SettingsRowText title={`Remove ${p.name} and its model configuration?`} /><div className="settings-row-controls"><SettingsButton type="button" onClick={() => setDeleting(null)}>Cancel</SettingsButton><SettingsButton className="danger" type="button" disabled={busy} onClick={() => void run(async () => { await onUpdateAppSettings({ ...appSettings, providers: providers.filter(v => v.id !== p.id) }); if (editing === p.id) setDraft(null); setDeleting(null); })}>Delete provider</SettingsButton></div></SettingsRow>}
    </div>; })}
    {!providers.length && <SettingsEmpty>No providers yet. Add one to get models.</SettingsEmpty>}
  </SettingsGroup>
    {draft && <form onSubmit={e => { e.preventDefault(); void run(() => save(draft)); }}>
      <SettingsGroup disabled={busy} title={editing ? `Edit ${draft.name || "provider"}` : "New provider"}>
        <SettingsFieldRow title="Provider ID" subtitle="Lowercase letters, numbers, - and _ (up to 32). It cannot change later."><SettingsTextField identifier required pattern="[a-z0-9_-]{1,32}" maxLength={32} disabled={!!editing} value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} /></SettingsFieldRow>
        <SettingsFieldRow title="Name"><SettingsTextField required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></SettingsFieldRow>
        <SettingsFieldRow title="Kind"><SettingsSelect value={draft.kind} onChange={e => { const kind = e.target.value as ProviderKind; setDraft({ ...draft, kind, baseUrl: null, apiStyle: kind === "openai-compatible" ? "chat-completions" : null, auth: { type: kind === "ollama" || kind === "lmstudio" ? "none" : "apiKey" } }); }}>{kinds.map(k => <option key={k}>{k}</option>)}</SettingsSelect></SettingsFieldRow>
        <SettingsFieldRow title="Base URL" subtitle={draft.kind === "openai-compatible" ? "Required for this kind of provider." : "Leave empty to use the provider's own address."}><SettingsTextField className="is-mono" type="url" required={draft.kind === "openai-compatible"} placeholder={draft.kind === "openai-compatible" ? "https://your-server/v1" : "Use provider default"} value={draft.baseUrl ?? ""} onChange={e => setDraft({ ...draft, baseUrl: e.target.value || null })} /></SettingsFieldRow>
        {draft.kind === "openai-compatible" && <SettingsFieldRow title="API style"><SettingsSelect value={draft.apiStyle ?? "chat-completions"} onChange={e => setDraft({ ...draft, apiStyle: e.target.value as "responses" | "chat-completions" })}><option value="chat-completions">Chat completions</option><option value="responses">Responses</option></SettingsSelect></SettingsFieldRow>}
        <SettingsToggleRow title="Anthropic-compatible (/v1/messages)" subtitle={`Works with ${providerEngines(draft).join(" and ")}.`}><SettingsToggleSwitch pressed={draft.anthropicCompatible ?? false} onClick={() => setDraft({ ...draft, anthropicCompatible: !(draft.anthropicCompatible ?? false) })} /></SettingsToggleRow>
        <SettingsFieldRow title="Authentication"><SettingsSelect value={draft.auth.type} onChange={e => setDraft({ ...draft, auth: auth(e.target.value as ProviderAuth["type"]) })}><option value="none">None</option><option value="apiKey">API key</option><option value="env">Environment variable</option><option value="command">Command</option></SettingsSelect></SettingsFieldRow>
        {draft.auth.type === "apiKey" && <SettingsFieldRow title={hasKey ? "Replace API key" : "API key"} subtitle={hasKey ? "A key is saved in your Keychain." : "Stored in your Keychain."}><div className="settings-field-actions"><SettingsTextField type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} />{hasKey && <SettingsButton type="button" className="danger" disabled={busy} onClick={() => void run(async () => { await providerDeleteApiKey(draft.id); setHasKey(false); })}>Remove key</SettingsButton>}</div></SettingsFieldRow>}
        {draft.auth.type === "env" && <SettingsFieldRow title="Environment variable"><SettingsTextField identifier className="is-mono" required value={draft.auth.var} onChange={e => setDraft({ ...draft, auth: { type: "env", var: e.target.value } })} /></SettingsFieldRow>}
        {draft.auth.type === "command" && <>
          <SettingsFieldRow title="Token command"><SettingsTextField identifier className="is-mono" required value={draft.auth.command} onChange={e => setDraft({ ...draft, auth: { ...draft.auth as Extract<ProviderAuth, { type: "command" }>, command: e.target.value } })} /></SettingsFieldRow>
          <SettingsFieldRow stacked title="Arguments" subtitle="One argument per line."><SettingsTextArea className="is-mono" value={draft.auth.args.join("\n")} onChange={e => setDraft({ ...draft, auth: { ...draft.auth as Extract<ProviderAuth, { type: "command" }>, args: e.target.value.split("\n").filter(Boolean) } })} /></SettingsFieldRow>
          <SettingsFieldRow title="Auth timeout (ms)"><SettingsNumberStepper type="number" min="1" step="1" value={draft.auth.timeoutMs ?? 15000} onChange={e => setDraft({ ...draft, auth: { ...draft.auth as Extract<ProviderAuth, { type: "command" }>, timeoutMs: Number(e.target.value) } })} /></SettingsFieldRow>
        </>}
        <div className="settings-form-actions">
          <span role="status" className="settings-help">{status}</span>
          <SettingsButton type="button" disabled={busy || !editing} aria-busy={busy} onClick={() => void run(async () => {
            await save(draft);
            const result = await providerTestAndFetch(draft.id);
            if (!result.ok) throw new Error(result.error);
            setDraft({ ...draft, models: result.models });
            await onUpdateAppSettings({ ...appSettings, providers: providers.map(p => p.id === draft.id ? { ...draft, models: result.models, modelsFetchedAt: Math.floor(Date.now() / 1000) } : p) });
            setStatus(result.latencyMs + " ms");
          })}>{busy && <span className="registry-spinner" aria-hidden="true" />}{busy ? "Testing…" : "Test & fetch models"}</SettingsButton>
          <SettingsButton type="submit" className="primary" disabled={busy}>Save provider</SettingsButton>
        </div>
      </SettingsGroup>
      <SettingsGroup disabled={busy} title="Models" subtitle="Models that are on appear in model pickers.">
        {draft.models.map(m => {
          const detectedImages = m.detectedSupportsImages ?? (m.supportsImagesSource !== "user" ? m.supportsImages : null);
          return <div key={m.id} className="settings-subrows"><SettingsToggleRow title={m.displayName || m.id}><SettingsToggleSwitch pressed={m.enabled} onClick={() => setDraft({ ...draft, models: draft.models.map(v => v.id === m.id ? { ...v, enabled: !(m.enabled) } : v) })} /></SettingsToggleRow>
          <SettingsFieldRow title="Images" subtitle={`Detected: ${detectedImages == null ? "unknown" : detectedImages ? "yes" : "no"}`}>
            <SettingsSelect aria-label={`Images for ${m.displayName || m.id}`} disabled={busy} value={m.supportsImagesSource === "user" ? m.supportsImages ? "on" : "off" : "auto"} onChange={e => {
              const auto = e.target.value === "auto";
              setDraft({ ...draft, models: draft.models.map(v => v.id === m.id ? { ...v, supportsImages: auto ? detectedImages ?? null : e.target.value === "on", supportsImagesSource: auto ? detectedImages == null ? null : "detected" : "user", detectedSupportsImages: detectedImages ?? null } : v) });
            }}><option value="auto">Auto</option><option value="on">On</option><option value="off">Off</option></SettingsSelect>
          </SettingsFieldRow>
          <ModelReasoningSettings model={m} disabled={busy} onChange={model => setDraft({ ...draft, models: draft.models.map(v => v.id === m.id ? model : v) })} onDetect={() => void run(async () => {
            await save(draft);
            const result = await providerTestAndFetch(draft.id, m.id);
            if (!result.ok) throw new Error(result.error);
            const next = { ...draft, models: result.models };
            setDraft(next);
            await onUpdateAppSettings({ ...appSettings, providers: providers.some(p => p.id === draft.id) ? providers.map(p => p.id === draft.id ? next : p) : [...providers, next] });
          })} /></div>; })}
        {!draft.models.length && <SettingsEmpty>No models yet. Test the connection to fetch them, or add one by ID.</SettingsEmpty>}
        <SettingsFieldRow title="Model ID" subtitle="Add a model by hand if the provider does not list it."><div className="settings-field-actions"><SettingsTextField identifier className="is-mono" value={manual} onChange={e => setManual(e.target.value)} /><SettingsButton type="button" disabled={!manual.trim()} onClick={() => { if (!draft.models.some(m => m.id === manual.trim())) setDraft({ ...draft, models: [...draft.models, { id: manual.trim(), enabled: true }] }); setManual(""); }}>Add model ID manually</SettingsButton></div></SettingsFieldRow>
      </SettingsGroup>
    </form>}
  </SettingsPage>;
}

export function AgentPolicyEditor({ policy, providers, onChange, tab, scope, engineControl = "select", onManageEngines }: { tab?: "defaults" | "subagents" | "roles"; policy: AgentPolicy; providers: ProviderEntry[]; onChange: (p: AgentPolicy) => void; scope?: "all" | "project"; /** "summary" shows the default engine read-only; it is changed in Engines. */ engineControl?: "select" | "summary"; onManageEngines?: () => void }) {
  const engines = useEngines();
  const models = providers.filter(p => p.enabled).flatMap(p => p.models.filter(m => m.enabled).map(m => ({ value: p.id + "/" + m.id, label: p.name + " / " + (m.displayName || m.id) })));
  const sub = policy.subagents;
  const chain = sub.enabled && sub.mode === "chain-of-command";
  const claudeReady = providers.some(p => p.enabled && providerEngines(p).includes("claude") && p.models.some(m => m.enabled));
  const modelSelect = (label: string, value: string, change: (value: string) => void) => <SettingsFieldRow title={label}><SettingsSelect value={value} onChange={e => change(e.target.value)}><option value="">Inherit</option>{models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</SettingsSelect></SettingsFieldRow>;
  const mode = !sub.enabled ? "single" : sub.mode ?? "custom";
  const modeNote = mode === "single" ? "One model handles each request; subagents are off." : mode === "chain-of-command" ? "The model commands; colonels delegate, majors verify, enlisted agents implement." : "The main agent can hand tasks to the roles you define.";
  const modeRow = <SettingsFieldRow title="How agents work" subtitle={modeNote}><SettingsSelect aria-label="Agent mode" value={mode} onChange={e => {
    const next = setAgentMode(policy, e.target.value as "single" | "custom" | "chain-of-command");
    if (next.subagents.enabled && next.subagents.mode === "chain-of-command" && !engines.some(engine => engine.id === next.defaultEngine && engine.protocol === "pi-rpc")) next.defaultEngine = "pi";
    onChange(next);
  }}><option value="single">One model</option><option value="chain-of-command">Chain of command</option><option value="custom">Delegate to your roles</option></SettingsSelect></SettingsFieldRow>;
  const engineName = engines.find(e => e.id === policy.defaultEngine)?.name ?? policy.defaultEngine;
  return <div className="registry-policy">
    {(!tab || tab === "defaults") && <SettingsGroup title={tab ? undefined : "Defaults"}>
      {modeRow}
      {engineControl === "summary"
        ? <SettingsRow><SettingsRowText title="Default engine" subtitle={<>New threads start with {engineName}. You change it in Engines.</>} /><SettingsButton type="button" onClick={onManageEngines} disabled={!onManageEngines}>Manage engines</SettingsButton></SettingsRow>
        : <SettingsFieldRow title={scope === "project" ? "Engine for this project" : "Default engine"} subtitle={!claudeReady ? "Claude Code needs an enabled Anthropic or Anthropic-compatible provider and model." : undefined}><SettingsSelect value={policy.defaultEngine} onChange={e => onChange({ ...policy, defaultEngine: e.target.value as AgentPolicy["defaultEngine"] })}>{engines.filter(e => e.enabled).map(e => <option key={e.id} value={e.id} disabled={chain && e.protocol !== "pi-rpc" || e.id === "claude" && !claudeReady}>{e.name}</option>)}</SettingsSelect></SettingsFieldRow>}
      {modelSelect("Default model", modelKey(policy.defaultModel), v => onChange({ ...policy, defaultModel: modelRef(v) }))}
    </SettingsGroup>}
    {(!tab || tab === "subagents") && <SettingsGroup title="Subagents" subtitle={chain ? "Turn and concurrency limits are shared by the whole command tree. Waiting coordinators share their slots with workers." : "Limits apply to each delegator. Nested custom roles have their own per-turn budgets."}>
      {modeRow}
      {([["maxConcurrent", "Max concurrent", 16, "How many subagents run at once. pi and Codex."], ["maxPerTurn", "Max per turn", 32, "How many subagents one turn may start. pi only."], ["maxDepth", "Max depth", 3, "How many levels of delegation are allowed. pi and Codex."]] as const).map(([field, label, max, note]) => <SettingsFieldRow key={field} title={label} subtitle={note}><SettingsNumberStepper type="number" min={1} max={max} value={sub[field]} onChange={e => onChange({ ...policy, subagents: { ...sub, [field]: Number(e.target.value) } })} /></SettingsFieldRow>)}
      <SettingsFieldRow stacked title="Allowed models" subtitle="Leave empty to allow any enabled model. pi only."><SettingsSelect multiple value={sub.allowedModels.map(modelKey)} onChange={e => onChange({ ...policy, subagents: { ...sub, allowedModels: Array.from(e.target.selectedOptions).flatMap(o => { const m = modelRef(o.value); return m ? [m] : []; }) } })}>{models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</SettingsSelect></SettingsFieldRow>
      {modelSelect("Default subagent model", modelKey(sub.defaultModel), v => onChange({ ...policy, subagents: { ...sub, defaultModel: modelRef(v) } }))}
    </SettingsGroup>}
    {chain && (!tab || tab === "subagents") && <ExecutionLimits policy={policy} onChange={onChange} />}
    {chain && tab === "defaults" && <SettingsGroup title="Team models" subtitle="Choose smaller cloud or local models where suitable. Inherit uses the default subagent model, then the parent's model. Edit tools and instructions in Roles.">
      {sub.roles.filter(isCommandRole).map(role => <div key={role.name}>{modelSelect(`${commandRoleTitle(role.name)} model`, modelKey(role.model), value => onChange({ ...policy, subagents: { ...sub, roles: sub.roles.map(r => r.name === role.name ? { ...r, model: modelRef(value) } : r) } }))}</div>)}
    </SettingsGroup>}
    {(!tab || tab === "roles") && <>
      <SettingsGroup title="Roles" subtitle={<>Named specialists with their own model, tools and instructions.{scope === "all" ? <> <strong>All projects:</strong> these roles apply to every project without its own roles. To give one project different roles, use its agent policy in Settings → Projects.</> : scope === "project" ? <> <strong>This project only:</strong> these roles replace the ones set for all projects.</> : null}</>}
        actions={!chain ? <SettingsButton type="button" onClick={() => onChange({ ...policy, subagents: { ...sub, roles: [...sub.roles, { name: "role-" + (sub.roles.length + 1), description: "", model: null, toolAccess: "read-only", instructions: "" }] } })}><Plus aria-hidden />Add role</SettingsButton> : undefined}>
        {modeRow}
        {!sub.roles.length && <SettingsEmpty>No roles yet.</SettingsEmpty>}
        {sub.roles.map((role, index) => chain && !isCommandRole(role) ? null : <div key={index} className="settings-card-block settings-role-summary">{chain ? commandRoleTitle(role.name) : role.name || `Role ${index + 1}`}</div>)}
      </SettingsGroup>
      {sub.roles.map((role, index) => {
        if (chain && !isCommandRole(role)) return null;
        const change = (patch: Partial<typeof role>) => onChange({ ...policy, subagents: { ...sub, roles: sub.roles.map((r, i) => i === index ? { ...r, ...patch } : r) } });
        return <SettingsGroup key={index} title={<>{chain ? commandRoleTitle(role.name) : `Role ${index + 1}`}{scope ? <small> · {scope === "all" ? "All projects" : "This project"}</small> : null}</>}
          actions={(!chain || !commandRoles.some(core => core.name === role.name)) ? <SettingsButton type="button" className="danger" onClick={() => onChange({ ...policy, subagents: { ...sub, roles: sub.roles.filter((_, i) => i !== index) } })}>Remove role</SettingsButton> : undefined}>
          <SettingsFieldRow title="Name"><SettingsTextField identifier readOnly={chain} value={role.name} onChange={e => change({ name: e.target.value })} /></SettingsFieldRow>
          <SettingsFieldRow title="Description"><SettingsTextField value={role.description} onChange={e => change({ description: e.target.value })} /></SettingsFieldRow>
          {modelSelect(chain ? `${commandRoleTitle(role.name)} model` : "Role model", modelKey(role.model), v => change({ model: modelRef(v) }))}
          <SettingsFieldRow title="Tool access"><SettingsSelect value={role.toolAccess} onChange={e => change({ toolAccess: e.target.value as "read-only" | "full" })}><option value="read-only">Read only</option><option value="full">Full</option></SettingsSelect></SettingsFieldRow>
          <SettingsFieldRow stacked title="Instructions"><SettingsTextArea value={role.instructions} onChange={e => change({ instructions: e.target.value })} /></SettingsFieldRow>
        </SettingsGroup>;
      })}
    </>}
  </div>;
}
export function SettingsAgentPolicySection({ appSettings, onUpdateAppSettings, workspace, tab, onUpdateWorkspaceSettings, pageTabs, onManageEngines }: Props & { onUpdateWorkspaceSettings?: (id: string, settings: Partial<WorkspaceSettings>) => Promise<void>; workspace?: WorkspaceInfo | null; tab?: "defaults" | "subagents" | "roles"; /** The tab strip shown directly under the page header. */ pageTabs?: ReactNode; onManageEngines?: () => void }) {
  const base = appSettings.agentPolicy ?? defaultAgentPolicy;
  const [scope, setScope] = useState<"all" | "project">(tab === "roles" && workspace && onUpdateWorkspaceSettings ? "project" : "all");
  const [policy, setPolicy] = useState(scope === "project" && workspace ? mergePolicy(base, workspace.settings.agentPolicy) : base);
  const [savedPolicy, setSavedPolicy] = useState(policy);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const validation = policyError(policy, appSettings.providers ?? []);
  const dirty = JSON.stringify(policy) !== JSON.stringify(savedPolicy);
  const save = async () => {
    if (!dirty || validation || saveState === "saving") return;
    setSaveState("saving"); setError("");
    try {
      if (scope === "project" && workspace && onUpdateWorkspaceSettings) {
        const changed = Object.fromEntries(Object.entries(policy.subagents).filter(([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(savedPolicy.subagents[key as keyof typeof savedPolicy.subagents])));
        await onUpdateWorkspaceSettings(workspace.id, { agentPolicy: {
          ...workspace.settings.agentPolicy,
          ...(policy.defaultEngine !== savedPolicy.defaultEngine ? { defaultEngine: policy.defaultEngine } : {}),
          subagents: { ...workspace.settings.agentPolicy?.subagents, ...changed },
        } });
      } else {
        await onUpdateAppSettings({ ...appSettings, agentPolicy: policy });
      }
      setSavedPolicy(policy); setSaveState("saved");
    } catch (e) { setError(String(e)); setSaveState("idle"); }
  };
  const actions = <>
    <SettingsUnsaved dirty={dirty} saving={saveState === "saving"} disabled={!!validation} onDiscard={() => { setPolicy(savedPolicy); setError(""); }} onSave={() => void save()} />
    <span className="settings-visually-hidden" role="status">{!dirty && saveState === "saved" ? "Policy saved" : ""}</span>
  </>;
  return <SettingsPage title="Models & Agents" subtitle={tab === "roles" && scope === "project" ? "Roles for this project only. They replace the ones set for all projects." : "Models, subagents and roles for new threads. A project can override them in Projects."} actions={actions}>
    {pageTabs}
    {tab === "roles" && <SettingsGroup><SettingsFieldRow title="Apply roles to" subtitle="Roles for all projects, or only for the current project."><SettingsSelect aria-label="Agent scope" value={scope} disabled={dirty || saveState === "saving"} onChange={e => {
      const nextScope = e.target.value as "all" | "project";
      const next = nextScope === "project" && workspace ? mergePolicy(base, workspace.settings.agentPolicy) : base;
      setScope(nextScope); setPolicy(next); setSavedPolicy(next); setSaveState("idle"); setError("");
    }}><option value="project" disabled={!workspace || !onUpdateWorkspaceSettings}>This project{workspace ? ` — ${workspace.name}` : " (select a project first)"}</option><option value="all">All projects</option></SettingsSelect></SettingsFieldRow></SettingsGroup>}
    <AgentPolicyEditor tab={tab} scope={scope} policy={policy} providers={appSettings.providers ?? []} onChange={next => { setPolicy(next); setError(""); }} engineControl={scope === "all" ? "summary" : "select"} onManageEngines={onManageEngines} />
    {(validation || error) && <SettingsCallout tone="error" style={{ marginTop: 16 }}>{validation || error}</SettingsCallout>}
    <SettingsGroup title="Details">
      <SettingsDisclosureRow label="What each engine supports">
        pi applies every setting on these pages. Codex applies concurrency, depth, the default subagent model and roles. Chat and Work always use one model; chain of command is only in Code.
      </SettingsDisclosureRow>
      {workspace && scope === "all" && tab !== "roles" && <SettingsDisclosureRow label={<>Settings in effect for {workspace.name}</>} summary="App defaults + project overrides">
        <SettingsDisabled><AgentPolicyEditor policy={mergePolicy(savedPolicy, workspace.settings.agentPolicy)} providers={appSettings.providers ?? []} onChange={() => {}} /></SettingsDisabled>
      </SettingsDisclosureRow>}
    </SettingsGroup>
  </SettingsPage>;
}
export function ProjectAgentPolicy({ workspace, appSettings, onUpdate }: { workspace: WorkspaceInfo; appSettings: AppSettings; onUpdate: (id: string, settings: Partial<WorkspaceSettings>) => Promise<void> }) {
  const base = appSettings.agentPolicy ?? defaultAgentPolicy;
  const override = workspace.settings.agentPolicy;
  const effective = mergePolicy(base, override);
  const [policy, setPolicy] = useState(effective);
  const [error, setError] = useState("");
  const validation = policyError(policy, appSettings.providers ?? []);
  return <SettingsDisclosureRow className="settings-agent-policy" label={`${workspace.name}: agent policy`}>
    <AgentPolicyEditor scope="project" policy={policy} providers={appSettings.providers ?? []} onChange={setPolicy} />
    {(validation || error) && <SettingsCallout tone="error" style={{ marginTop: 16 }}>{validation || error}</SettingsCallout>}
    <div className="settings-form-actions settings-form-actions--page">
      <SettingsButton type="button" onClick={() => void onUpdate(workspace.id, { agentPolicy: null }).then(() => setPolicy(base)).catch(e => setError(String(e)))}>Use app policy</SettingsButton>
      <SettingsButton type="button" className="primary" disabled={!!validation} onClick={() => void onUpdate(workspace.id, { agentPolicy: policy }).catch(e => setError(String(e)))}>Save project override</SettingsButton>
    </div>
  </SettingsDisclosureRow>;
}
