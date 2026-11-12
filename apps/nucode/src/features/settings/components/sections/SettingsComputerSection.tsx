import { SettingsPage, SettingsGroup, SettingsSelect, SettingsTextArea, SettingsNumberStepper, SettingsTextField, SettingsButton, SettingsCallout, SettingsListRow, SettingsFieldRow, SettingsRow, SettingsRowText, SettingsStatus, SettingsSwitchRow, SettingsUnsaved, SettingsDisclosureRow } from "@/features/design-system/components/settings/SettingsPrimitives";
import { SettingsRuntimeSetup } from "./SettingsRuntimeSetup";
import { useEffect, useState } from "react";
import type { AppSettings } from "@/types";
import { computerRequest, computerRequestPermissions } from "@services/tauri";
import { defaultComputerSettings, type ComputerRun, type ComputerSettings } from "@/features/computer/computer";
import { modelKey, modelRef } from "@settings/registry";
import "@/features/computer/computer.css";
function allowedApps(entries: (string | ComputerSettings["allowedApps"][number])[]): ComputerSettings["allowedApps"] {
  return entries.map(entry => {
    const app = typeof entry === "string" ? { bundleId: entry, access: "full" as const } : entry;
    return { ...app, access: app.bundleId.trim().toLowerCase() === "com.apple.systempreferences" ? "read-only" : app.access };
  });
}
export function SettingsComputerSection({ appSettings, onUpdateAppSettings, onManageEngines }: { onManageEngines?: () => void; appSettings: AppSettings; onUpdateAppSettings: (s: AppSettings) => Promise<void> }) {
  const [draft, setDraft] = useState({ ...defaultComputerSettings, ...appSettings.computer, allowedApps: allowedApps(appSettings.computer?.allowedApps ?? []) });
  const storedDraft = () => ({ ...defaultComputerSettings, ...appSettings.computer, allowedApps: allowedApps(appSettings.computer?.allowedApps ?? []) });
  const [baseline, setBaseline] = useState(() => JSON.stringify(storedDraft()));
  const dirty = JSON.stringify(draft) !== baseline;
  const [status, setStatus] = useState<ComputerRun>({ steps: [] });
  const [busy, setBusy] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [alwaysApps, setAlwaysApps] = useState<string[]>([]);
  const refresh = () => computerRequest<ComputerRun>({ action: "status" }).then(setStatus).catch(e => setError(String(e)));
  const refreshApps = () => computerRequest<string[]>({ action: "appApprovals" }).then(setAlwaysApps).catch(e => setError(String(e)));
  useEffect(() => { void refresh(); void refreshApps(); }, []);
  const forgetApp = (app: string) => computerRequest({ action: "forgetApp", app }).then(refreshApps).catch(e => setError(String(e)));
  const update = (value: Partial<ComputerSettings>) => setDraft(s => ({ ...s, ...value }));
  const requestAccess = async (checkFirst = false) => {
    setRequesting(true); setError("");
    try {
      if (checkFirst) {
        const current = await computerRequest<ComputerRun>({ action: "status" });
        setStatus(current);
        if (current.permissions?.screen && current.permissions.accessibility) return;
      }
      const permissions = await computerRequestPermissions();
      setStatus(s => ({ ...s, permissions }));
      if (permissions.unsupported) throw new Error("Computer Use requires macOS");
      for (const pane of ["screen", "accessibility"] as const) {
        if (!permissions[pane]) await computerRequest({ action: "permissions", pane });
      }
    } catch (e) { setError(String(e)); } finally { setRequesting(false); }
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (draft.enabled && (!draft.planner || !draft.grounding)) throw new Error("Select planner and grounding models");
      if (draft.enabled) { setStatus(s => ({ ...s, setup: "Preparing Python 3.12 environment…" })); await computerRequest({ action: "prepare" }); }
      await onUpdateAppSettings({ ...appSettings, computer: { ...draft, allowedApps: allowedApps(draft.allowedApps.map(a => ({ ...a, bundleId: a.bundleId.trim() })).filter(a => a.bundleId)), deniedApps: draft.deniedApps.map(s => s.trim()).filter(Boolean) } });
      setBaseline(JSON.stringify(draft));
      await refresh();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const options = (appSettings.providers ?? []).filter(p => p.enabled).flatMap(p => p.models.filter(m => m.enabled).map(m => <option key={`${p.id}/${m.id}`} value={`${p.id}/${m.id}`} data-description={`${p.name} / ${m.displayName || m.id}`}>{(m.displayName || m.id).replace(/ reasoning preview$/i, " reasoning")}</option>));
  const readOnlySystem = (id: string) => id.trim().toLowerCase() === "com.apple.systempreferences";
  const appsLabel = draft.appAccess !== "ask" ? "Allowed apps" : draft.askApproval ? "Apps allowed without asking" : "Listed apps";
  return <SettingsPage className="computer-settings" title="Computer Use" subtitle="Let agents see and operate apps on your Mac, with the limits you set here."
    actions={<SettingsUnsaved dirty={dirty} saving={busy} disabled={requesting} onDiscard={() => { setDraft(JSON.parse(baseline)); setError(""); }} onSave={() => void save()} />}>
    <SettingsRuntimeSetup engine="computer" onManage={onManageEngines} />
    {error && <SettingsCallout tone="error" style={{ marginTop: 16 }}>{error}</SettingsCallout>}
    {status.setup && <SettingsCallout tone="info" role="status" style={{ marginTop: 16 }}>{status.setup}</SettingsCallout>}
    <SettingsGroup disabled={busy || requesting} title="General">
      <SettingsSwitchRow title="Enable Computer Use" subtitle="Lets agents control apps. Needs the macOS permissions below." pressed={draft.enabled} onClick={() => { update({ enabled: !(draft.enabled) }); if (!(draft.enabled)) void requestAccess(true); }} />
      <SettingsFieldRow title="Input mode" subtitle="Background keeps your mouse and keyboard free. Foreground takes them over."><SettingsSelect value={draft.mode} onChange={e => update({ mode: e.target.value as ComputerSettings["mode"] })}><option value="background" data-description="You can keep using your Mac." data-recommended>Background</option><option value="foreground" data-description="Takes over the mouse.">Foreground</option></SettingsSelect></SettingsFieldRow>
      <SettingsSwitchRow title="Allow foreground fallback" subtitle={<>When an app ignores background input, such as Notes' search field, it comes forward briefly and uses the mouse for that step{draft.askApproval ? ", after you approve" : ""}.</>} pressed={draft.allowForegroundFallback} onClick={() => update({ allowForegroundFallback: !(draft.allowForegroundFallback) })} />
      <SettingsSwitchRow title="Ask for approval" subtitle="Asks before using a new app and before risky actions such as send, buy or delete. When off, Computer Use goes ahead without asking." pressed={draft.askApproval} onClick={() => update({ askApproval: !(draft.askApproval) })} />
      <SettingsSwitchRow title="Show virtual cursor" subtitle="Shows where the agent is pointing." pressed={draft.virtualCursor} onClick={() => update({ virtualCursor: !(draft.virtualCursor) })} />
      <SettingsFieldRow title="Typing confirmation" subtitle="Typing in ordinary text fields of full-access apps goes ahead; secure fields and Enter need approval."><SettingsSelect value={draft.confirmTyping} onChange={e => update({ confirmTyping: e.target.value as ComputerSettings["confirmTyping"] })}><option value="sensitive">Sensitive fields and risky actions</option><option value="always">Always</option><option value="risky-only" data-description="Allow Return in ordinary text fields.">Risky only</option></SettingsSelect></SettingsFieldRow>
      <SettingsDisclosureRow label="Typing details">{draft.confirmTyping === "risky-only" ? "Return is allowed in ordinary text fields of full-access apps. " : ""}Shortcuts outside the safe list (⌘N, ⌘F, ⌘A, ⌘C, ⌘V, ⌘Z, ⌘⇧Z, arrows, Tab, Escape) need approval, and ⌘S always does.</SettingsDisclosureRow>
    </SettingsGroup>
    <SettingsGroup disabled={busy || requesting} title="Models" subtitle="Pick models from your providers. The planner decides what to do; grounding finds where to click.">
      {(["planner", "grounding"] as const).map(role => <SettingsFieldRow key={role} title={role === "planner" ? "Vision planner model" : "Grounding model"}><SettingsSelect value={modelKey(draft[role])} onChange={e => update({ [role]: modelRef(e.target.value) })}><option value="">Select a registry model</option>{options}</SettingsSelect></SettingsFieldRow>)}
      <SettingsFieldRow title="Grounding mode"><SettingsSelect value={draft.groundingMode} onChange={e => update({ groundingMode: e.target.value as ComputerSettings["groundingMode"] })}><option value="elements" data-description="Use accessibility elements to locate controls." data-recommended>Accessibility elements</option><option value="pixels" data-description="Locate controls using pixel coordinates.">Vision model</option><option value="ui-tars" data-description="Use preset coordinates.">UI-TARS</option></SettingsSelect></SettingsFieldRow>
      {draft.groundingMode === "ui-tars" && <SettingsFieldRow title="Grounding coordinates"><SettingsSelect value={`${draft.groundingWidth}x${draft.groundingHeight}`} onChange={e => { const [groundingWidth, groundingHeight] = e.target.value.split("x").map(Number); update({ groundingWidth, groundingHeight }); }}><option value="1920x1080">UI-TARS-1.5-7B · 1920 × 1080</option><option value="1000x1000">UI-TARS-72B · 1000 × 1000</option></SettingsSelect></SettingsFieldRow>}
    </SettingsGroup>
    <SettingsGroup disabled={busy || requesting} title="Apps" subtitle="Read-only apps allow navigation clicks, scrolling and opening the app. Typing, shortcuts, setting controls, risky clicks and dragging are blocked.">
      <SettingsFieldRow title="App access" help={draft.appAccess === "ask" ? `Computer Use can use any installed app${draft.askApproval ? " you approve. The first time a run uses an app, nucode asks to allow it for this session or always" : ""}. Password managers, Keychain, terminals and macOS password prompts are never allowed, and it never types into password fields.` : "Computer Use can use only the apps listed below."}><SettingsSelect value={draft.appAccess} onChange={e => update({ appAccess: e.target.value as ComputerSettings["appAccess"] })}><option value="ask" data-description="Any installed app except blocked ones." data-recommended>Any app</option><option value="listed" data-description="Only the apps listed below.">Only listed apps</option></SettingsSelect></SettingsFieldRow>
      {draft.appAccess === "ask" && draft.askApproval && (alwaysApps.length
        ? alwaysApps.map(app => <SettingsListRow key={app} title={app} meta="Always allowed"><SettingsButton onClick={() => void forgetApp(app)}>Remove</SettingsButton></SettingsListRow>)
        : <SettingsRow><SettingsRowText title="Always allowed apps" subtitle="Apps you choose Always allow for appear here. None yet." /></SettingsRow>)}
      <SettingsFieldRow stacked title={appsLabel} subtitle="Bundle IDs, one per line."><SettingsTextArea className="is-mono" value={draft.allowedApps.map(a => a.bundleId).join("\n")} onChange={e => update({ allowedApps: allowedApps(e.target.value.split("\n").map(bundleId => draft.allowedApps.find(a => a.bundleId === bundleId) ?? { bundleId, access: "full" })) })} /></SettingsFieldRow>
      {draft.allowedApps.map((app, index) => app.bundleId.trim() && <SettingsFieldRow key={index} title={`Access for ${app.bundleId}`}><SettingsSelect disabled={readOnlySystem(app.bundleId)} value={app.access} onChange={e => update({ allowedApps: draft.allowedApps.map((a, i) => i === index ? { ...a, access: e.target.value as typeof a.access } : a) })}><option value="full">Full</option><option value="read-only">Read-only</option></SettingsSelect></SettingsFieldRow>)}
      <SettingsFieldRow stacked title="Blocked apps" subtitle="Bundle IDs, one per line." help={<>Password managers, Keychain, terminal apps and known banking apps are always blocked. System Settings is read-only, with Privacy &amp; Security, Users &amp; Groups, Passwords, Lock Screen, Touch ID &amp; Password, Wallet &amp; Apple Pay, Login Items &amp; Extensions, Sharing, Network and Battery → Options blocked.</>}><SettingsTextArea className="is-mono" value={draft.deniedApps.join("\n")} onChange={e => update({ deniedApps: e.target.value.split("\n") })} /></SettingsFieldRow>
    </SettingsGroup>
    <SettingsGroup disabled={busy || requesting} title="Limits">
      <SettingsFieldRow title="Maximum steps" subtitle="Actions allowed per run."><SettingsNumberStepper type="number" min={1} max={500} value={draft.maxSteps} onChange={e => update({ maxSteps: Number(e.target.value) })} /></SettingsFieldRow>
      <SettingsFieldRow title="Maximum seconds" subtitle="Total time allowed per run."><SettingsNumberStepper type="number" min={1} max={3600} value={draft.maxSeconds} onChange={e => update({ maxSeconds: Number(e.target.value) })} /></SettingsFieldRow>
      <SettingsFieldRow title="Planning seconds per step" subtitle="How long the planner may take to choose one action, including retries. Raise it for slow providers or local models."><SettingsNumberStepper type="number" min={10} max={600} value={draft.plannerSeconds} onChange={e => update({ plannerSeconds: Number(e.target.value) })} /></SettingsFieldRow>
      <SettingsFieldRow title="Stop shortcut" subtitle="Press it to stop a run at any time."><SettingsTextField className="is-mono" value={draft.shortcut} onChange={e => update({ shortcut: e.target.value })} /></SettingsFieldRow>
    </SettingsGroup>
    <SettingsGroup title="macOS permissions" subtitle="Computer Use needs these to see the screen and operate apps."
      actions={<><SettingsButton disabled={requesting} onClick={() => void refresh()}>Refresh</SettingsButton><SettingsButton className="primary" disabled={requesting || busy} onClick={() => void requestAccess()}>{requesting ? "Requesting…" : "Request access"}</SettingsButton></>}>
      {(["screen", "accessibility"] as const).map(pane => <SettingsRow key={pane}><SettingsRowText title={pane === "screen" ? "Screen Recording" : "Accessibility"} subtitle={<SettingsStatus tone={status.permissions?.[pane] ? "ready" : "warning"}>{status.permissions?.[pane] ? "Granted" : "Not granted"}</SettingsStatus>} /><SettingsButton aria-label={`Open System Settings — ${pane === "screen" ? "Screen Recording" : "Accessibility"}`} onClick={() => void computerRequest({ action: "permissions", pane }).catch(e => setError(String(e)))}>Open System Settings</SettingsButton></SettingsRow>)}
      <SettingsRow><SettingsRowText title="Apply Screen Recording" subtitle="Screen Recording takes effect only after you quit and reopen nucode." /><SettingsButton disabled={requesting || busy} onClick={() => void computerRequest({ action: "restart" }).catch(e => setError(String(e)))}>Quit &amp; Reopen</SettingsButton></SettingsRow>
    </SettingsGroup>
  </SettingsPage>;
}
