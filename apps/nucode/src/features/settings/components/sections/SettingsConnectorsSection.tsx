import { SettingsBadge, SettingsButton, SettingsCallout, SettingsEmpty, SettingsFieldRow, SettingsGroup, SettingsListRow, SettingsPage, SettingsRow, SettingsRowText, SettingsSelect, SettingsTextArea, SettingsTextField, SettingsToggleRow, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";
import { RowMenu } from "@/features/chat/RowMenu";
import Plug from "lucide-react/dist/esm/icons/plug";
import Plus from "lucide-react/dist/esm/icons/plus";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Play from "lucide-react/dist/esm/icons/play";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import { useEffect, useState } from "react";
import type { AppSettings, McpCredential, McpServerEntry, McpConnectionResult, WorkspaceInfo, WorkspaceSettings } from "@/types";
import { connectorRequest } from "@services/tauri";

const reserved = ["codegraph", "nucode-browser", "nucode-computer", "nucode-diagnostics"];
const builtin: McpServerEntry = { id: "codegraph", name: "CodeGraph", enabled: true, approval: "auto" };
const empty = (): McpServerEntry => ({ id: "", name: "", enabled: true, approval: "ask", transport: { type: "stdio", command: "", args: [], env: {} } });
const names = (text: string) => text.split("\n").map(s => s.trim()).filter(Boolean);
type Props = { appSettings: AppSettings; onUpdateAppSettings: (s: AppSettings) => Promise<void>; workspace?: WorkspaceInfo | null; onUpdateWorkspaceSettings: (id: string, s: Partial<WorkspaceSettings>) => Promise<void> };

export function SettingsConnectorsSection({ appSettings, onUpdateAppSettings, workspace, onUpdateWorkspaceSettings }: Props) {
  const [scope, setScope] = useState("app");
  const local = scope === "workspace" && !!workspace;
  const globals = [...(appSettings.mcpServers ?? [])];
  for (const entry of [{ id: "nucode-computer", name: "Computer Use", enabled: appSettings.computer?.enabled ?? false, approval: "auto" } satisfies McpServerEntry, { ...builtin, enabled: appSettings.codegraphEnabled ?? true }, { id: "nucode-browser", name: "Browser", enabled: true, approval: appSettings.browser?.approval ?? "ask" } satisfies McpServerEntry]) {
    if (!globals.some(s => s.id === entry.id)) globals.push(entry);
  }
  const overrides = workspace?.settings.mcpServers ?? [];
  const entries = local ? [...globals.map(s => ({ ...s, enabled: overrides.find(o => o.id === s.id)?.enabled ?? (s.enabled && (s.id !== "codegraph" || (workspace?.settings.codegraphEnabled ?? true))) })), ...overrides.filter(s => !globals.some(g => g.id === s.id))] : globals;
  const [draft, setDraft] = useState<McpServerEntry | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<McpConnectionResult | null>(null);
  const workspaceId = local ? workspace?.id : undefined;
  useEffect(() => {
    let active = true;
    setSecrets({}); setSaved({});
    if (editing) void connectorRequest<Record<string, boolean>>({ action: "secrets", id: editing, workspaceId }).then(v => { if (active) setSaved(v); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [editing, workspaceId]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const persist = async (next: McpServerEntry[]) => {
    if (local) await onUpdateWorkspaceSettings(workspace!.id, { mcpServers: next });
    else await onUpdateAppSettings({ ...appSettings, codegraphEnabled: next.find(s => s.id === "codegraph")?.enabled ?? true, mcpServers: next });
  };
  const save = async () => {
    if (!draft) return;
    if (!editing && (reserved.includes(draft.id) || entries.some(s => s.id.replace(/-/g, "_") === draft.id.replace(/-/g, "_")))) throw new Error("Connector ID is reserved or already in use");
    const normalized = { ...draft, toolAllowlist: draft.toolAllowlist ? names(draft.toolAllowlist.join("\n")) : null, toolDenylist: draft.toolDenylist ? names(draft.toolDenylist.join("\n")) : null };
    const current = local ? overrides : globals;
    await persist(editing ? current.map(s => s.id === editing ? normalized : s) : [...current, normalized]);
    for (const [name, value] of Object.entries(secrets)) {
      if (value) await connectorRequest({ action: "setSecret", id: draft.id, name, value, workspaceId });
    }
    setSecrets({}); setEditing(draft.id);
    setSaved(await connectorRequest<Record<string, boolean>>({ action: "secrets", id: draft.id, workspaceId }));
  };
  const credentials = draft?.transport?.type === "stdio" ? draft.transport.env : draft?.transport?.headers ?? {};
  const setCredentials = (values: Record<string, McpCredential>) => {
    if (!draft?.transport) return;
    setDraft({ ...draft, transport: draft.transport.type === "stdio" ? { ...draft.transport, env: values } : { ...draft.transport, headers: values } });
  };
  const secretInput = (name: string) => <SettingsFieldRow title={name === "bearer" ? "Bearer token" : `${name} secret`} subtitle={saved[name] ? "Saved in Keychain" : undefined}><SettingsTextField aria-label={name === "bearer" ? "Bearer token" : `${name} secret`} type="password" autoComplete="new-password" value={secrets[name] ?? ""} placeholder={saved[name] ? "Saved in Keychain" : "Enter secret"} onChange={e => setSecrets({ ...secrets, [name]: e.target.value })} /></SettingsFieldRow>;
  const configured = (id: string) => ["nucode-browser", "nucode-computer"].includes(id);
  const transportMeta = (entry: McpServerEntry) => configured(entry.id) ? `Configure in ${entry.id === "nucode-browser" ? "Browser" : "Computer Use"} settings` : !entry.transport ? "Built in" : entry.transport.type === "stdio" ? `Local command · ${entry.transport.command || "not set"}` : `HTTP · ${entry.transport.url || "no URL"}`;
  const newConnector = () => { setDraft(empty()); setEditing(null); setSecrets({}); setSaved({}); setResult(null); };
  return <SettingsPage title="Connectors" subtitle="Connect external tools (MCP servers) to your agents."
    actions={undefined}>
    {error && <SettingsCallout tone="error">{error}</SettingsCallout>}
    <SettingsGroup title="Connectors" subtitle="Connectors that are on are available to agents after an engine restarts."
      actions={<SettingsButton disabled={busy} onClick={newConnector}><Plus aria-hidden />Add connector</SettingsButton>}>
      <SettingsFieldRow title="Scope" subtitle="Connectors set for all workspaces apply everywhere. A single project can switch any of them on or off for itself."><SettingsSelect disabled={busy} value={local ? "workspace" : "app"} onChange={e => { setScope(e.target.value); setDraft(null); setEditing(null); setResult(null); }}><option value="app">All workspaces</option>{workspace && <option value="workspace">{workspace.name}</option>}</SettingsSelect></SettingsFieldRow>
      {entries.map(s => {
        const inherited = local && globals.some(g => g.id === s.id);
        const name = s.name || s.id;
        const menu = [
          ...(inherited
            ? [{ label: "Use global setting", icon: <RotateCcw size={14} />, disabled: busy || !overrides.some(o => o.id === s.id), onClick: () => void run(() => persist(overrides.filter(o => o.id !== s.id))) }]
            : configured(s.id) ? [] : [{ label: "Edit", icon: <Pencil size={14} />, disabled: busy, onClick: () => { setDraft(structuredClone(s)); setEditing(s.id); setResult(null); } }]),
          { label: "Test connection", icon: <Play size={14} />, disabled: busy, onClick: () => void run(async () => setResult(await connectorRequest<McpConnectionResult>({ action: "test", id: s.id, workspaceId }))) },
          ...(!inherited && !reserved.includes(s.id) ? [{ label: "Delete", icon: <Trash2 size={14} />, danger: true, disabled: busy, onClick: () => void run(async () => { await persist((local ? overrides : globals).filter(o => o.id !== s.id)); if (editing === s.id) { setDraft(null); setEditing(null); } }) }] : []),
        ];
        return <SettingsListRow key={s.id} className={s.enabled ? undefined : "is-off"} icon={<Plug aria-hidden />} title={name} badge={reserved.includes(s.id) ? <SettingsBadge>Built in</SettingsBadge> : undefined} meta={transportMeta(s)}>
          <SettingsToggleSwitch aria-label={`Enable ${name}`} pressed={s.enabled} disabled={busy} onClick={() => { const enabled = !s.enabled; void run(async () => {
            if (inherited) await persist([...overrides.filter(o => o.id !== s.id), { id: s.id, enabled }]);
            else await persist((local ? overrides : globals).map(o => o.id === s.id ? { ...o, enabled } : o));
          }); }} />
          <RowMenu portal size="md" label={name} actions={menu}>{null}</RowMenu>
        </SettingsListRow>;
      })}
      {!entries.length && <SettingsEmpty>No connectors yet.</SettingsEmpty>}
    </SettingsGroup>
    {draft && <form onSubmit={e => { e.preventDefault(); void run(save); }}>
      <SettingsGroup disabled={busy} title={editing ? "Edit connector" : "New connector"}>
        <SettingsFieldRow title="Connector ID" subtitle="Lowercase letters, numbers, - and _ (up to 32)."><SettingsTextField identifier required pattern="[a-z0-9_-]{1,32}" maxLength={32} disabled={!!editing} value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} /></SettingsFieldRow>
        <SettingsFieldRow title="Name"><SettingsTextField required value={draft.name ?? ""} onChange={e => setDraft({ ...draft, name: e.target.value })} /></SettingsFieldRow>
        {draft.transport && <>
          <SettingsFieldRow title="Transport"><SettingsSelect value={draft.transport.type} onChange={e => { setSecrets({}); setDraft({ ...draft, transport: e.target.value === "stdio" ? { type: "stdio", command: "", args: [], env: {} } : { type: "http", url: "", headers: {} } }); }}><option value="stdio">Local command (stdio)</option><option value="http">HTTP</option></SettingsSelect></SettingsFieldRow>
          {draft.transport.type === "stdio" ? <>
            <SettingsFieldRow title="Command"><SettingsTextField identifier className="is-mono" required value={draft.transport.command} onChange={e => setDraft({ ...draft, transport: { ...draft.transport as Extract<NonNullable<McpServerEntry["transport"]>, { type: "stdio" }>, command: e.target.value } })} /></SettingsFieldRow>
            <SettingsFieldRow stacked title="Arguments" subtitle="One argument per line."><SettingsTextArea className="is-mono" value={draft.transport.args.join("\n")} onChange={e => { if (draft.transport?.type === "stdio") setDraft({ ...draft, transport: { ...draft.transport, args: e.target.value ? e.target.value.split("\n") : [] } }); }} /></SettingsFieldRow>
            <SettingsFieldRow title="Working directory"><SettingsTextField className="is-mono" value={draft.transport.cwd ?? ""} onChange={e => { if (draft.transport?.type === "stdio") setDraft({ ...draft, transport: { ...draft.transport, cwd: e.target.value || null } }); }} /></SettingsFieldRow>
          </> : <>
            <SettingsFieldRow stacked title="URL"><SettingsTextField className="is-mono" required type="url" value={draft.transport.url} onChange={e => { if (draft.transport?.type === "http") setDraft({ ...draft, transport: { ...draft.transport, url: e.target.value } }); }} /></SettingsFieldRow>
            <SettingsToggleRow title="Use bearer token" subtitle="Sends a token you store in the Keychain with every request."><SettingsToggleSwitch pressed={!!draft.transport.bearer} onClick={() => { setSecrets({ ...secrets, bearer: "" }); if (draft.transport?.type === "http") setDraft({ ...draft, transport: { ...draft.transport, bearer: !draft.transport.bearer ? { secret: true } : null } }); }} /></SettingsToggleRow>
            {draft.transport.bearer && secretInput("bearer")}
          </>}
        </>}
        <SettingsFieldRow stacked title="Allowed tools" subtitle="One tool per line. Leave empty to allow every tool."><SettingsTextArea className="is-mono" value={draft.toolAllowlist?.join("\n") ?? ""} onChange={e => setDraft({ ...draft, toolAllowlist: e.target.value ? e.target.value.split("\n") : null })} /></SettingsFieldRow>
        <SettingsFieldRow stacked title="Denied tools" subtitle="One tool per line. These are never offered to agents."><SettingsTextArea className="is-mono" value={draft.toolDenylist?.join("\n") ?? ""} onChange={e => setDraft({ ...draft, toolDenylist: e.target.value ? e.target.value.split("\n") : null })} /></SettingsFieldRow>
        <SettingsFieldRow title="Approval"><SettingsSelect value={draft.approval ?? "auto"} onChange={e => setDraft({ ...draft, approval: e.target.value as "auto" | "ask" })}><option value="ask">Ask for every tool call</option><option value="auto">Automatic</option></SettingsSelect></SettingsFieldRow>
        <div className="settings-form-actions">
          <SettingsButton type="button" className="ghost" onClick={() => { setDraft(null); setEditing(null); setSecrets({}); }}>Cancel</SettingsButton>
          <SettingsButton type="button" onClick={() => void run(async () => { await save(); setResult(await connectorRequest<McpConnectionResult>({ action: "test", id: draft.id, workspaceId })); })}>Test connection</SettingsButton>
          <SettingsButton type="submit" className="primary">Save connector</SettingsButton>
        </div>
      </SettingsGroup>
      {draft.transport && <SettingsGroup title={draft.transport.type === "stdio" ? "Environment variables" : "Headers"} subtitle="Secret values are stored in the Keychain, never in settings."
        actions={<SettingsButton type="button" onClick={() => { let name = "NEW_FIELD"; while (Object.prototype.hasOwnProperty.call(credentials, name)) name += "_"; setCredentials({ ...credentials, [name]: { secret: true } }); }}><Plus aria-hidden />Add {draft.transport.type === "stdio" ? "environment variable" : "header"}</SettingsButton>}>
        {Object.entries(credentials).map(([name, value]) => <div className="settings-subrows" key={name}>
          <SettingsFieldRow title="Field name"><SettingsTextField identifier className="is-mono" required defaultValue={name} onBlur={e => { const next = e.target.value; if (next !== name && !Object.prototype.hasOwnProperty.call(credentials, next)) { const values = { ...credentials }; delete values[name]; values[next] = value; setCredentials(values); setSecrets({ ...secrets, [name]: "" }); } }} /></SettingsFieldRow>
          <SettingsToggleRow title={`Store ${name} in Keychain`}><SettingsToggleSwitch pressed={"secret" in value} onClick={() => { setCredentials({ ...credentials, [name]: !("secret" in value) ? { secret: true } : { value: "" } }); setSecrets({ ...secrets, [name]: "" }); }} /></SettingsToggleRow>
          {"secret" in value ? secretInput(name) : <SettingsFieldRow title={`${name} value`}><SettingsTextField identifier className="is-mono" value={value.value} onChange={e => setCredentials({ ...credentials, [name]: { value: e.target.value } })} /></SettingsFieldRow>}
          <div className="settings-form-actions"><SettingsButton type="button" className="danger" onClick={() => { const values = { ...credentials }; delete values[name]; setCredentials(values); setSecrets({ ...secrets, [name]: "" }); }}>Remove {name}</SettingsButton></div>
        </div>)}
        {!Object.keys(credentials).length && <SettingsEmpty>None yet.</SettingsEmpty>}
      </SettingsGroup>}
    </form>}
    {result && <SettingsGroup title="Connection test">{result.ok
      ? <><div className="settings-card-block" role="status">Connected · {result.latencyMs} ms · {result.tools?.length ?? 0} tools</div>{result.tools?.map(t => <SettingsRow key={t.name}><SettingsRowText title={t.name} subtitle={t.description} /></SettingsRow>)}</>
      : <SettingsCallout tone="error">{result.error}</SettingsCallout>}</SettingsGroup>}
  </SettingsPage>;
}
