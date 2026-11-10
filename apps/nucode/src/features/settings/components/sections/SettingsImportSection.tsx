import { SettingsPage, SettingsGroup, SettingsRow, SettingsButton, SettingsToggleRow, SettingsToggleSwitch, SettingsSegmented } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, LoaderCircle } from "lucide-react";
import type { AppSettings, ChatImportScan, ChatImportAutoStatus, ImportDetection, ImportEntry, ImportLog, ImportProgress, ImportedTranscript } from "@/types";
import { getAppSettings, updateAppSettings, importRequest, pickImportExport } from "@services/tauri";
import { notifyImportsChanged, notifySetupChanged } from "@services/events";
import "./registry.css";
import "./import.css";

const labels: Record<string, string> = { codex: "Codex", "codex-project": "Codex projects", claude: "Claude Code", "claude-cli": "Claude Code CLI", cowork: "Cowork", "codex-mcp": "Codex MCP servers", "claude-mcp": "Claude MCP servers", "claude.ai": "Claude chats", chatgpt: "ChatGPT chats" };
type HistorySelection = { logId: string; key: string; transcript: ImportedTranscript };

export function ChatMigration({ wizard = false, actionsTarget, onComplete, onSkip, onBusy, onSettings, onChanged }: {
  /** Wizard footer slot: the Skip and primary actions render there, like every other setup step. */
  actionsTarget?: HTMLElement | null;
  wizard?: boolean; onComplete?: (summary: string) => void; onSkip?: () => void;
  onBusy?: (busy: boolean) => void; onSettings?: (settings: AppSettings) => void; onChanged?: () => Promise<void>;
}) {
  const [options, setOptions] = useState<NonNullable<AppSettings["chatImport"]>>({ auto: wizard, sources: ["claude", "codex"], includeArchived: false });
  const [ready, setReady] = useState(false);
  const [scan, setScan] = useState<ChatImportScan | null>(null);
  const [mode, setMode] = useState<"copy" | "move">("copy");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<ImportLog | null>(null);
  const [auto, setAuto] = useState<ChatImportAutoStatus | null>(null);
  const [confirmation, setConfirmation] = useState<string[]>([]);
  const [progress, setProgress] = useState<ImportProgress>({ running: false, completed: 0, total: 0 });
  useEffect(() => {
    let active = true;
    void getAppSettings().then(s => { if (active) { setOptions({ ...(s.chatImport ?? { auto: false, sources: ["claude", "codex"], includeArchived: false }), ...(wizard ? { auto: true } : {}) }); setReady(true); } }).catch(e => { if (active) setError(String(e)); });
    void importRequest<ChatImportAutoStatus>("autoStatus").then(s => { if (active) setAuto(s); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [wizard]);
  useEffect(() => {
    if (!ready) return;
    let active = true; setScanning(true);
    void importRequest<ChatImportScan>("scan", { includeArchived: options.includeArchived }).then(s => { if (active) setScan(s); }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setScanning(false); });
    return () => { active = false; };
  }, [ready, options.includeArchived]);
  useEffect(() => {
    if (!busy) return;
    let active = true;
    const timer = window.setInterval(() => void importRequest<ImportProgress>("status").then(p => { if (active) setProgress(p); }).catch(e => { if (active) setError(String(e)); }), 400);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy]);
  const save = async (value: typeof options) => {
    const settings = await updateAppSettings({ ...await getAppSettings(), chatImport: value });
    onSettings?.(settings); notifySetupChanged();
  };
  const change = async (value: typeof options) => {
    setError("");
    try { if (!wizard) await save(value); setOptions(value); } catch (e) { setError(String(e)); }
  };
  const selected = scan?.sessions.filter(s => options.sources.includes(s.source)) ?? [];
  const pending = selected.filter(s => ["new", "updated", "chatMode", ...(mode === "move" ? ["current"] : [])].includes(s.state) || s.state === "duplicate" && !options.sources.includes("claude")).length;
  const summary = log ? `Brought over ${log.created.length} chats into ${new Set(log.created.map(r => r.workspaceId).filter(Boolean)).size} projects. ${log.skipped.length} skipped.` : "";
  const run = async () => {
    setBusy(true); onBusy?.(true); setError("");
    try {
      await save(options);
      if (!scan?.sources.some(s => s.chats > 0)) { onComplete?.("No chats to import."); return; }
      // Refresh with the selected sources so duplicate suppression follows this selection.
      await importRequest("scan", options);
      const result = await importRequest<ImportLog>("migrate", { ...options, mode });
      setLog(result); notifyImportsChanged(); await onChanged?.();
      if (!result.cancelled) onComplete?.(`Brought over ${result.created.length} chats. ${result.skipped.length} skipped.`);
      if (!wizard) setScan(await importRequest<ChatImportScan>("scan", { includeArchived: options.includeArchived }));
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); onBusy?.(false); }
  };
  const undo = async (confirmChanged = false) => {
    if (!log) return;
    setBusy(true); setError("");
    try {
      const result = await importRequest<ImportLog | { needsConfirmation: string[] }>("undo", { logId: log.id, confirmChanged });
      if ("needsConfirmation" in result) { setConfirmation(result.needsConfirmation); return; }
      setConfirmation([]); setLog(result); notifyImportsChanged(); await onChanged?.();
      setScan(await importRequest<ChatImportScan>("scan", { includeArchived: options.includeArchived }));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const none = !!scan && scan.sources.every(s => s.chats === 0);
  const disabled = busy || scanning || !ready;
  return <div className="chat-migration">
    {(!ready || scanning) && <p role="status">Looking for Claude Code and Codex chats…</p>}
    {scan?.sources.map(s => <SettingsToggleRow key={s.source} title={labels[s.source]} subtitle={s.chats ? `${s.chats} chats in ${s.projects} folders · ${s.alreadyImported} in nucode` : "None found on this Mac"}><SettingsToggleSwitch aria-label={`Include ${labels[s.source]}`} disabled={disabled} pressed={options.sources.includes(s.source)} onClick={() => void change({ ...options, sources: options.sources.includes(s.source) ? options.sources.filter(v => v !== s.source) : [...options.sources, s.source] })} /></SettingsToggleRow>)}
    {none && <p>No Claude Code or Codex chats were found on this Mac.</p>}
    {!none && <div className="import-mode"><strong>When bringing chats over</strong><SettingsSegmented label="When bringing chats over" value={mode} options={[{ value: "copy", label: "Copy", disabled }, { value: "move", label: "Move", disabled }]} onChange={v => setMode(v as "copy" | "move")} /><p>{mode === "copy" ? "Keep the originals in Claude and Codex." : "Send the originals to the Trash after nucode verifies its copy."}</p></div>}
    {!wizard && <SettingsToggleRow title="Include archived chats"><SettingsToggleSwitch aria-label="Include archived chats" pressed={options.includeArchived} disabled={disabled} onClick={() => void change({ ...options, includeArchived: !options.includeArchived })} /></SettingsToggleRow>}
    <SettingsToggleRow title={wizard ? "Keep bringing in new chats automatically" : "Bring in new chats automatically"} subtitle="Checks on launch and every 15 minutes. Always copies and never touches the originals. Chats used in the last 10 minutes wait until they're idle."><SettingsToggleSwitch aria-label={wizard ? "Keep bringing in new chats automatically" : "Bring in new chats automatically"} pressed={options.auto} disabled={disabled} onClick={() => void change({ ...options, auto: !options.auto })} /></SettingsToggleRow>
    {!wizard && <p className="import-auto-status">{auto?.lastRunAt ? `Last checked ${Math.max(0, Math.floor((Date.now() - auto.lastRunAt) / 60000))} minutes ago · ${auto.imported} new chats` : "Not checked automatically yet."}{auto?.error && ` · ${auto.error}`}</p>}
    {scan?.warnings.map((w, i) => <p key={i} role="status">{w}</p>)}
    {error && <p role="alert">{error}</p>}
    {busy && <div role="status"><p>Bringing chats over… {progress.completed}/{progress.total}</p><progress aria-label="Chat import progress" max={Math.max(1, progress.total)} value={progress.completed} /><SettingsButton onClick={() => void importRequest("cancel").catch(e => setError(String(e)))}>Cancel</SettingsButton></div>}
    {wizard && actionsTarget && createPortal(<>
      <SettingsButton type="button" className="ghost setup-skip" disabled={busy} onClick={onSkip}>Skip for now</SettingsButton>
      <SettingsButton type="button" className="primary setup-primary" disabled={disabled || !scan || !none && !pending} aria-busy={busy} onClick={() => void run()}>{busy ? <><LoaderCircle className="setup-spinner" size={16} />Bringing chats over…</> : none ? <>Continue <ArrowRight size={16} /></> : <>Bring them over <ArrowRight size={16} /></>}</SettingsButton>
    </>, actionsTarget)}
    {!busy && !(wizard && actionsTarget) && <div className="import-actions"><SettingsButton className="primary" disabled={disabled || !scan || !none && !pending} onClick={() => void run()}>{wizard ? none ? "Continue" : "Bring them over" : `Bring chats over (${pending})`}</SettingsButton>{wizard && <SettingsButton disabled={busy} onClick={onSkip}>Skip</SettingsButton>}</div>}
    {log && <div role="status"><p>{log.undone ? "Import undone." : log.cancelled ? "Import cancelled. Completed chats were kept." : summary}</p>{!!log.skipped.length && <details><summary>Skipped chats ({log.skipped.length})</summary><ul>{log.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul></details>}{log.warnings.map((w, i) => <p key={i}>{w}</p>)}{!log.undone && <SettingsButton disabled={busy} onClick={() => void undo()}>Undo</SettingsButton>}</div>}
    {!!confirmation.length && <div role="alert"><p>These chats changed in nucode: {confirmation.join(", ")}. Remove their imported files?</p><SettingsButton onClick={() => void undo(true)}>Remove changed imports</SettingsButton><SettingsButton onClick={() => setConfirmation([])}>Keep imports</SettingsButton></div>}
  </div>;
}

export function SettingsImportSection({ historyOnly = false }: { historyOnly?: boolean }) {
  const [detection, setDetection] = useState<ImportDetection | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>({ running: false, completed: 0, total: 0 });
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [summary, setSummary] = useState<ImportLog | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<{ id: string; titles: string[] } | null>(null);
  const [history, setHistory] = useState<HistorySelection | null>(null);
  const refresh = async () => setLogs(await importRequest<ImportLog[]>("logs"));
  useEffect(() => {
    let active = true;
    void importRequest<ImportLog[]>("logs").then(v => { if (active) setLogs(v); }).catch(e => { if (active) setError(String(e)); });
    void importRequest<ImportProgress>("status").then(v => { if (active) setProgress(v); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!busy && !progress.running) return;
    let active = true;
    const timer = window.setInterval(() => {
      void importRequest<ImportProgress>("status").then(v => {
        if (!active) return;
        setProgress(v);
        if (!v.running) { void refresh().catch(e => setError(String(e))); notifyImportsChanged(); }
      }).catch(e => { if (active) setError(String(e)); });
    }, 400);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, progress.running]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); setProgress(p => ({ ...p, running: false })); }
  };
  const detect = async (path?: string) => {
    const result = await importRequest<ImportDetection>(path ? "export" : "detect", path ? { path } : {});
    setDetection(result); setArchived(false); setSummary(null);
    setSelected(new Set(result.entries.filter(e => !e.archived && e.kind !== "skipped").map(e => e.key)));
  };
  const toggle = (entries: ImportEntry[], checked: boolean) => setSelected(previous => {
    const next = new Set(previous);
    for (const e of entries) { if (checked) next.add(e.key); else next.delete(e.key); }
    return next;
  });
  const undo = async (id: string, confirmChanged = false) => {
    const result = await importRequest<ImportLog | { needsConfirmation: string[] }>("undo", { logId: id, confirmChanged });
    if ("needsConfirmation" in result) { setConfirmation({ id, titles: result.needsConfirmation }); return; }
    setConfirmation(null); setHistory(null); setSummary(result); await refresh(); notifyImportsChanged();
  };
  const sources = [...new Set(detection?.entries.map(e => e.source))];
  const disabled = busy || progress.running;
  return <SettingsPage className="registry-settings import-settings" title={historyOnly ? "Imported Work history" : "Import"} subtitle="Bring conversations and projects into nucode.">
    {!historyOnly && <SettingsGroup title="Claude & Codex chats"><ChatMigration onChanged={refresh} /></SettingsGroup>}
    <SettingsGroup title={historyOnly ? "Imported history" : "Advanced import"}>

    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!historyOnly && <>
      <SettingsRow className="import-actions"><SettingsButton disabled={disabled} onClick={() => void run(() => detect())}>Detect local sources</SettingsButton><SettingsButton disabled={disabled} onClick={() => void run(async () => { const path = await pickImportExport(); if (path) await detect(path); })}>Import chats from export file…</SettingsButton></SettingsRow>
      {detection && <>
        <SettingsToggleRow  title={<>Include archived</>}><SettingsToggleSwitch pressed={archived} disabled={disabled} onClick={() => { setArchived(!(archived)); toggle(detection.entries.filter(v => v.archived && v.kind !== "skipped"), !(archived)); }} /></SettingsToggleRow>
        {detection.warnings.map((warning, i) => <p key={i} role="status">{warning}</p>)}
        {sources.length === 0 && <p>No supported local history found.</p>}
        {sources.map(source => {
          const all = detection.entries.filter(e => e.source === source);
          const visible = all.filter(e => archived || !e.archived);
          const projects = [...new Set(visible.map(e => e.project || "Unfiled history"))];
          return <details className="import-source" key={source} open>
            <summary>{labels[source] ?? source}: {new Set(all.filter(e => e.cwd).map(e => e.cwd)).size} projects, {all.length} {source.includes("mcp") ? "servers" : source === "cowork" ? "tasks" : "items"}</summary>
            {projects.map(project => {
              const entries = visible.filter(e => (e.project || "Unfiled history") === project);
              const selectable = entries.filter(e => e.kind !== "skipped");
              return <details className="import-project" key={project} open>
                <summary>{project}</summary>
                <SettingsToggleRow  title={<>Select project</>}><SettingsToggleSwitch aria-label={`Select ${source} ${project}`} disabled={disabled || !selectable.length} pressed={selectable.length > 0 && selectable.every(e => selected.has(e.key))} onClick={() => toggle(selectable, !(selectable.length > 0 && selectable.every(e => selected.has(e.key))))} /></SettingsToggleRow>
                {entries.map(entry => <SettingsToggleRow className="import-entry" key={entry.key} title={<><span>{entry.title}{entry.archived && <small>Archived</small>}{entry.missingCwd && <small>Missing folder: {entry.cwd} — {entry.kind === "thread" ? "imports into Chat mode" : "read-only history"}</small>}{entry.needsSecrets && <small>Needs secrets — configure in Connectors</small>}{entry.warning && <small>{entry.warning}</small>}</span></>}><SettingsToggleSwitch disabled={disabled || entry.kind === "skipped"} pressed={selected.has(entry.key)} onClick={() => toggle([entry], !(selected.has(entry.key)))} /></SettingsToggleRow>)}
              </details>;
            })}
          </details>;
        })}
        <SettingsButton disabled={disabled || !selected.size} onClick={() => void run(async () => { const log = await importRequest<ImportLog>("run", { keys: [...selected] }); setSummary(log); await refresh(); notifyImportsChanged(); })}>Import selected ({selected.size})</SettingsButton>
      </>}
    </>}
    {disabled && <div role="status"><p>{progress.phase === "detect" ? "Detecting sources…" : "Import operation in progress…"} {progress.completed}/{progress.total}</p><progress aria-label="Import progress" max={Math.max(1, progress.total)} value={progress.completed} /><SettingsButton onClick={() => void importRequest("cancel").catch(e => setError(String(e)))}>Cancel import</SettingsButton></div>}
    {summary && <div role="status"><h3>{summary.undone ? "Import undone" : summary.cancelled ? "Import cancelled" : "Import complete"}</h3><p>{summary.created.length} imported, {summary.skipped.length} skipped.</p>{[...summary.skipped, ...summary.warnings].map((message,i) => <p key={i}>{message}</p>)}</div>}
    {confirmation && <div role="alert"><p>These imported items were continued or changed: {confirmation.titles.join(", ")}. Undo will remove their imported files. Continuations created with Continue are kept.</p><SettingsButton disabled={disabled} onClick={() => void run(() => undo(confirmation.id, true))}>Remove changed imports</SettingsButton><SettingsButton onClick={() => setConfirmation(null)}>Keep imports</SettingsButton></div>}
    <h3>Import history</h3>
    {!logs.length && <p>No imports yet.</p>}
    {logs.filter(log => !historyOnly || log.created.some(e => e.kind === "work")).map(log => <details key={log.id} className="import-source"><summary>{log.id} · {log.created.length} items{log.undone ? " · undone" : ""}</summary>
      {!log.undone && <><SettingsButton disabled={disabled} onClick={() => void run(() => undo(log.id))}>Undo import</SettingsButton>{log.created.filter(e => !["connector", "project"].includes(e.kind) && (!historyOnly || e.kind === "work")).map(entry => <SettingsButton className="import-history-link" disabled={disabled} key={entry.key} onClick={() => void run(async () => setHistory({ logId: log.id, key: entry.key, transcript: await importRequest<ImportedTranscript>("read", { logId: log.id, key: entry.key }) }))}>{entry.title}</SettingsButton>)}</>}
      {[...log.skipped,...log.warnings].map((message,i) => <p key={i}>{message}</p>)}
    </details>)}
    {history && <article className="import-transcript" aria-label="Imported transcript"><h3>{history.transcript.title}</h3><p>{history.transcript.kind === "thread" && !history.transcript.readOnly ? "Native conversation" : "Read-only imported snapshot"} · {history.transcript.source}</p>
      {history.transcript.kind === "thread" && !history.transcript.readOnly ? <p>Open this conversation in its project, or in Chat mode for chats without a project, to continue.</p> : history.transcript.kind === "work" ? <p>Available in Work mode with copied outputs and uploads. Open Work mode to continue as a new task.</p> : <SettingsButton disabled={disabled} onClick={() => void run(async () => { await importRequest("continue", { logId: history.logId, key: history.key }); notifyImportsChanged(); setNotice("Continuation created. Open Chat mode to continue in pi."); })}>Continue in pi</SettingsButton>}<SettingsButton onClick={() => setHistory(null)}>Close transcript</SettingsButton>
      {history.transcript.messages?.map((m,i) => <div key={i}><strong>{m.role}</strong><p>{m.text}</p></div>)}
      {history.transcript.raw?.map((entry,i) => <details key={i}><summary>Audit entry {i + 1}</summary><pre>{JSON.stringify(entry,null,2)}</pre></details>)}
      {!!history.transcript.attachments?.length && <><h4>Copied attachments</h4><ul>{history.transcript.attachments.map(name => <li key={name}>{name}</li>)}</ul></>}
    </article>}
  </SettingsGroup></SettingsPage>;
}
