import { SetupWizard } from "@/features/onboarding/SetupWizard";
import type { SetupSection } from "@/features/onboarding/setupState";
import { EvalsView } from "@/features/evals/EvalsView";
import { FeedbackComposer } from "@/features/diagnostics/FeedbackComposer";
import { diagnosticContext, record } from "@/features/diagnostics/client";
import { FeatureSettings, features, useFeatures } from "@settings/features";
import { useSidebarDensity } from "@settings/hooks/useSidebarDensity";
import { SidebarEngine } from "@app/components/SidebarTree";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { IconButton } from "@/features/design-system/components/IconButton";
import type { AppMode, AppSettings } from "@/types";
import { getAppSettings, updateAppSettings, setWindowMode } from "@services/tauri";
import { useTauriEvent } from "@app/hooks/useTauriEvent";
import { useSidebarState } from "@/features/layout/hooks/useSidebarState";
import { subscribeMenuToggleProjectsSidebar, subscribeMenuViewAction, notifySetupChanged, type MenuViewAction } from "@services/events";
import { matchesShortcut } from "@utils/shortcuts";
import { useWindowLabel } from "@/features/layout/hooks/useWindowLabel";
import { useThemePreference } from "@/features/layout/hooks/useThemePreference";
import { useUiScaleShortcuts } from "@/features/layout/hooks/useUiScaleShortcuts";
import { DEFAULT_THEME_ID } from "@/features/themes/defaults";
import { WorkView } from "@/features/work/WorkView";
import { ChatView } from "./ChatView";
import "./chat.css";

const modes: AppMode[] = ["code", "chat", "work"];
const ModeContext = createContext<{ mode: AppMode; select: (mode: AppMode) => void; updateSettings: (settings: AppSettings) => void } | null>(null);

function ModeScale({ settings, setSettings }: { settings: AppSettings; setSettings: Dispatch<SetStateAction<AppSettings | null>> }) {
  useUiScaleShortcuts({ settings, setSettings: update => setSettings(current => current ? typeof update === "function" ? update(current) : update : current), saveSettings: updateAppSettings });
  return null;
}

const modeInfo: Record<AppMode, { label: string; description: string }> = {
  code: { label: "Code", description: "Build, debug and ship" },
  chat: { label: "Chat", description: "Ask, learn and explore" },
  work: { label: "Work", description: "Hand off tasks that make files" },
};

/** The mode menu, as in Codex: the current mode is the sidebar's title; its menu lists each mode with what it is for.
 *  Search sits on the right of the same row, so the row below is only the "New …" action. */
export function ModeSwitcher({ onSearch, searchLabel = "Search", searchExpanded, accessory }: { onSearch?: () => void; searchLabel?: string; searchExpanded?: boolean; accessory?: ReactNode } = {}) {
  const enabled = useFeatures();
  const context = useContext(ModeContext);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open]);
  const search = onSearch && <IconButton type="button" className="ghost mode-menu-search" aria-label={searchLabel} title={searchLabel} aria-expanded={searchExpanded} onClick={onSearch}><Search aria-hidden /></IconButton>;
  if (!context) return search || accessory ? <div className="mode-menu-header">{accessory}{search}</div> : null;
  const available = modes.filter(mode => mode === "code" || (mode === "chat" ? enabled.chatMode : enabled.workMode));
  const current = modeInfo[context.mode];
  return <div className="mode-menu-header">
    <nav className="mode-switcher mode-menu" aria-label="App mode" ref={root}>
      {available.length < 2 ? <span className="mode-menu-trigger">{current.label}</span> : <button ref={trigger} type="button" className="mode-menu-trigger" aria-label={`Mode: ${current.label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>{current.label}</span><ChevronDown aria-hidden />
      </button>}
      {open && <div className="mode-menu-list ds-popover" role="menu" aria-label="Switch mode">
        {available.map(mode => <button type="button" role="menuitemradio" aria-checked={context.mode === mode} key={mode} className="ds-popover-item mode-menu-item" onClick={() => { setOpen(false); context.select(mode); }}>
          <span className="mode-menu-text"><span className="mode-menu-name">{modeInfo[mode].label}</span><span className="mode-menu-description">{modeInfo[mode].description}</span></span>
          {context.mode === mode && <Check className="mode-menu-check" aria-hidden />}
        </button>)}
      </div>}
    </nav>
    {accessory}{search}
  </div>;
}

export function useModeSettings(settings: AppSettings | null) {
  const update = useContext(ModeContext)?.updateSettings;
  useEffect(() => { if (settings) update?.(settings); }, [settings, update]);
  return update;
}

export function modeShortcut(event: KeyboardEvent, settings: AppSettings): AppMode | undefined {
  if (!event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !/^[123]$/.test(event.key)) return;
  if (Object.entries(settings).some(([key, value]) => key.endsWith("Shortcut") && typeof value === "string" && matchesShortcut(event, value))) return;
  const next = modes[Number(event.key) - 1];
  const enabled = features(settings);
  return next === "code" || (next === "chat" ? enabled.chatMode : enabled.workMode) ? next : undefined;
}

export function ModeShell({ children, renderSettings }: { children: ReactNode; renderSettings?: (onClose: () => void, section?: SetupSection) => ReactNode }) {
  useSidebarDensity();
  const label = useWindowLabel();
  const [mode, setMode] = useState<AppMode>("code");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => { diagnosticContext({ mode }); if (settings?.features?.diagnostics) record({ kind: "ux", area: "ui", code: "ui.mode_switch", message: "Mode selected", context: { mode } }); }, [mode, settings]);
  const { sidebarCollapsed, setSidebarCollapsed } = useSidebarState();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useTauriEvent(subscribeMenuToggleProjectsSidebar, () => setSidebarCollapsed(!sidebarCollapsed), { enabled: mode !== "code" && !settingsOpen });
  const [setupSection, setSetupSection] = useState<SetupSection>();
  const [setupWorkspace, setSetupWorkspace] = useState<string>();
  useEffect(() => {
    if (mode === "code" && setupWorkspace) { notifySetupChanged(setupWorkspace); setSetupWorkspace(undefined); }
  }, [mode, setupWorkspace]);
  const [evalsFull, setEvalsFull] = useState<{runId?:string}|null>(null);
  useEffect(() => { const open = (event:Event) => setEvalsFull({runId:(event as CustomEvent<{runId?:string}>).detail?.runId}); window.addEventListener("nucode:evals-full", open); return () => window.removeEventListener("nucode:evals-full", open); }, []);
  useThemePreference(settings ?? { theme: DEFAULT_THEME_ID }, () => {
    if (!settings) return;
    const next = { ...settings, theme: "system" };
    setSettings(next);
    void updateAppSettings(next).catch(e => setError(String(e)));
  }, loaded);
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener("nucode:provider-settings", open);
    return () => window.removeEventListener("nucode:provider-settings", open);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void getAppSettings().then(value => {
      if (cancelled) return;
      setSettings(value);
      // A chosen default mode wins; otherwise the window reopens in the mode it last used.
      const saved = value.defaultMode && modes.includes(value.defaultMode) ? value.defaultMode : value.windowModes?.[label];
      setMode(saved && modes.includes(saved) ? saved : "code");
      setLoaded(true);
    }).catch(e => { if (!cancelled) { setError(String(e)); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [label]);
  const select = async (next: AppMode) => {
    try { await setWindowMode(next); setMode(next); setError(""); }
    catch (e) { setError(String(e)); }
  };
  useEffect(() => {
    if (!settings) return;
    const keydown = (event: KeyboardEvent) => {
      const next = modeShortcut(event, settings);
      if (next && !event.defaultPrevented) { event.preventDefault(); void setWindowMode(next).then(() => setMode(next)).catch(e => setError(String(e))); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [settings]);
  // View › Code / Chat / Work in the menu bar.
  useTauriEvent<MenuViewAction>(subscribeMenuViewAction, action => {
    if (!action.startsWith("mode_")) return;
    const next = action.slice(5) as AppMode;
    const enabled = features(settings);
    if (next === "code" || (next === "chat" ? enabled.chatMode : enabled.workMode)) void select(next);
  });
  useEffect(() => { const enabled = features(settings); if ((mode === "chat" && !enabled.chatMode) || (mode === "work" && !enabled.workMode)) { setMode("code"); void setWindowMode("code").catch(e => setError(String(e))); } }, [mode, settings]);
  if (!loaded) return null;
  return <FeatureSettings.Provider value={settings}>{settings?.features?.diagnostics && <FeedbackComposer />}<ModeContext.Provider value={{ mode, select: next => { void select(next); }, updateSettings: setSettings }}>
    {mode !== "code" && !settingsOpen && settings && <ModeScale settings={settings} setSettings={setSettings} />}
    {error && <p role="alert" className="chat-mode-error">{error}</p>}
    {evalsFull && settings && <main className="evals-full"><div className="evals-windowbar" data-tauri-drag-region aria-hidden="true" /><EvalsView full initialRunId={evalsFull.runId} appSettings={settings} onUpdateAppSettings={async next => { const saved = await updateAppSettings(next); setSettings(saved); return saved; }} onClose={() => setEvalsFull(null)} /></main>}
    <div style={{ display: evalsFull ? "none" : "contents" }}>
    {mode === "code" && <SidebarEngine.Provider value={settings?.agentPolicy?.defaultEngine ?? "pi"}>{children}</SidebarEngine.Provider>}
    {mode === "chat" && settings && <ChatView settings={settings} onOpenSettings={() => setSettingsOpen(true)} />}
    {mode === "work" && settings && <WorkView settings={settings} onOpenSettings={() => setSettingsOpen(true)} />}
    </div>
    {settingsOpen && renderSettings?.(() => { setSettingsOpen(false); setSetupSection(undefined); void getAppSettings().then(setSettings).catch(e => setError(String(e))); }, setupSection)}
    <SetupWizard onSettings={setSettings} onFinish={async (next, workspaceId) => { await setWindowMode(next); setMode(next); setSetupWorkspace(workspaceId); setSettingsOpen(false); }} />
  </ModeContext.Provider></FeatureSettings.Provider>;
}
