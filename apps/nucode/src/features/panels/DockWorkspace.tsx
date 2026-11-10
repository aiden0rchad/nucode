import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useSidebarReorder } from "@app/hooks/useSidebarReorder";
import { tabLabel } from "./tabLabel";
import { flushSync } from "react-dom";
import { TITLEBAR_THREAD_TOOLS_ID } from "@/features/app/components/MainTopbar";
import { ArrowLeft, ArrowRight, FileDiff, Folder, Globe, LayoutGrid, Maximize2, MessageSquare, Minimize2, Plus, Terminal, X, PanelRight } from "lucide-react";
import { isMacPlatform } from "@utils/platformPaths";
import { IconButton } from "@/features/design-system/components/IconButton";
import { DiagnosticBoundary } from "@/features/diagnostics/DiagnosticBoundary";
import { RowMenu } from "@/features/chat/RowMenu";
import { BrowserPane, type BrowserContext } from "@/features/browser/BrowserPane";
import { SidebarCollapseButton } from "@/features/layout/components/SidebarResizeHandle";
import { WindowCaptionControls } from "@/features/layout/components/WindowCaptionControls";
import { usePanelResize } from "@/features/layout/hooks/usePanelResize";
import { useFeatures } from "@settings/features";
import type { useSidePanelState } from "@app/hooks/useSidePanelState";
import type { WorkspaceShellProps } from "./SidePanel";
import { dockGeometry, dockPanes, hideDockPane, initialDock, moveDockPane, panelReducer, removeDockPane, resizeDockSplit, showDockPane, type DockBox, type DockLayout, type DockSide } from "./panelState";

import { BrowserTabIcon, PanelTabList, pageStatusText } from "./PanelTabList";
import { panelToolIcons } from "./toolIcons";

// Browser keeps its own titlebar toggle; its new tab lists every other tool (as Codex does). Files toggles only while open.
// Every tool has a titlebar toggle (Claude Code order: inspector, terminal, changes, browser, files).
const secondaryTools = new Set<string>();
const toolIcons = panelToolIcons;
const toolOrder = ["git", "terminal", "sidechat", "files", "agents", "prompts", "background"];
const defaultShortcuts: Record<string, string> = isMacPlatform() ? { git: "⌃⇧G", files: "⌘P" } : { git: "Ctrl+Shift+G", files: "Ctrl+P" };
const quickTools = [{ id: "terminal", label: "Terminal", icon: Terminal }, { id: "git", label: "Changes", icon: FileDiff }, { id: "browser", label: "Browser", icon: Globe }, { id: "files", label: "Files", icon: Folder }];
const full: DockBox = { x: 0, y: 0, w: 100, h: 100 };
// Docking the rail (288px) below this width would leave the conversation under ~670px, so the rail floats instead.
const RAIL_DOCK_MIN = 960;
const position = (box: DockBox): CSSProperties => ({ "--dock-box-x": box.x / 100, "--dock-box-width": box.w / 100, top: `${box.y}%`, height: `${box.h}%` } as CSSProperties);
// A pane lifted into the titlebar row starts one titlebar height higher and grows by the same amount.
const lifted = (box: DockBox): CSSProperties => ({ ...position(box), top: `calc(${box.y}% - var(--titlebar-h))`, height: `calc(${box.h}% + var(--titlebar-h))` });

type Controller = ReturnType<typeof useSidePanelState>;
export function DockWorkspace({ children, scope, title, tools = [], searchUrl, onInterrupt, titleActions, actions = [], onNavigate, sessionRail, onBrowserContext, controller }: WorkspaceShellProps & { controller: Controller }) {
  const { state, update, resize, layout, mainRef, openTool, openPage, close, browser, pageStatuses, busy, error, history, historyIndex, navigate } = controller;
  const features = useFeatures();
  const saved = state.dock ?? initialDock(state, Boolean(sessionRail));
  const setDock = (fn: (layout: DockLayout) => DockLayout) => update(state => ({ ...state, open: true, dock: fn(state.dock ?? initialDock(state, Boolean(sessionRail))) }));
  const available = new Set(["conversation", ...(sessionRail ? ["session"] : []), ...tools.map(tool => tool.id), ...(features.browser ? ["browser"] : [])]);
  let tree = state.open ? saved.tree : { type: "pane" as const, id: "conversation" };
  for (const id of dockPanes(tree)) if (!available.has(id)) tree = removeDockPane(tree, id) ?? { type: "pane", id: "conversation" };
  const sessionOpen = dockPanes(tree).includes("session");
  tree = removeDockPane(tree, "session") ?? { type: "pane", id: "conversation" };
  const geometry = dockGeometry(tree), visible = new Set(Object.keys(geometry.panes));
  const reorderPane = useSidebarReorder((source, targetPaneId) => {
    if (visible.has(source) && source !== "conversation") setDock(layout => moveDockPane(layout, source, "bottom", targetPaneId));
  }, undefined, { ignore: 'button, input, select, [role="tab"]' });
  const expanded = saved.expanded && visible.has(saved.expanded) ? saved.expanded : null;
  const stage = useRef<HTMLDivElement>(null);
  const sessionSpace = useRef<HTMLDivElement>(null);
  const [sessionFloating, setSessionFloating] = useState(false);
  const [compact, setCompact] = useState(layout.conversationWidth < 760);
  // Codex layout: a browser pane in the top-right corner lifts its tab strip into the titlebar row,
  // and the conversation's titlebar controls end where the browser column begins.
  const browserBox = geometry.panes.browser;
  const titlebarPane = !compact && !expanded && browserBox && browserBox.y === 0 && Math.round(browserBox.x + browserBox.w) === 100 ? "browser" : null;
  useLayoutEffect(() => {
    const element = stage.current; if (!element) return;
    const composer = mainRef.current?.querySelector<HTMLElement>(".composer");
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      resize.appRef.current?.style.setProperty("--dock-composer-height", `${composer?.offsetHeight ?? 0}px`);
      setCompact(width < 760);
      setSessionFloating((sessionSpace.current?.getBoundingClientRect().width ?? width) < RAIL_DOCK_MIN);
    };
    const observer = new ResizeObserver(measure); observer.observe(element);
    if (sessionSpace.current) observer.observe(sessionSpace.current);
    if (composer) observer.observe(composer);
    measure();
    return () => observer.disconnect();
  }, [layout.conversationWidth, geometry.panes.conversation?.w, scope, mainRef, resize.appRef]);
  const focused = expanded ?? (saved.focused && visible.has(saved.focused) ? saved.focused : "conversation");
  const covered = Boolean(expanded || compact && focused !== "conversation");
  const conversation = compact ? full : geometry.panes.conversation;
  // A rail that cannot dock without squeezing the conversation waits behind its toggle and opens as a popover
  // over the conversation. Closing that popover keeps the saved choice, so the rail docks again once there is room.
  const [peek, setPeek] = useState(false);
  useEffect(() => { if (!sessionFloating) setPeek(false); }, [sessionFloating]);
  const sessionShown = sessionOpen && !covered && (!sessionFloating || peek);
  const panes = useRef(new Map<string, HTMLElement>());
  const browserTabsRef = useRef<HTMLDivElement>(null);
  const browserContentId = useId();
  const [browserTabFocus, setBrowserTabFocus] = useState<{ id: string; selection?: string } | null>(null);
  const closedTabFocus = useRef<{ id: string; next?: string } | null>(null);
  const mounted = useRef({ scope, ids: new Set<string>() });
  if (mounted.current.scope !== scope) mounted.current = { scope, ids: new Set() };
  for (const id of visible) mounted.current.ids.add(id);
  if (sessionOpen) mounted.current.ids.add("session");
  const { startResize } = usePanelResize();
  const hidePane = (id: string) => {
    const restore = panes.current.get(id)?.contains(document.activeElement);
    setDock(layout => hideDockPane(layout, id));
    tools.find(tool => tool.id === id)?.onClose?.();
    if (restore) {
      const toolbar = resize.appRef.current?.querySelector<HTMLElement>(".dock-toolbar");
      // Browser and Files lose their toggle once closed, so focus returns to View options, where they now live.
      ((secondaryTools.has(id) ? null : [...(toolbar?.querySelectorAll<HTMLElement>("[data-pane-toggle]") ?? [])].find(button => button.dataset.paneToggle === id))
        ?? toolbar?.querySelector<HTMLElement>('[data-pane-toggle="browser"]') ?? toolbar?.querySelector<HTMLElement>('[aria-label="Actions for View options"]'))?.focus();
    }
  };
  const toggle = (id: string) => {
    if (id === "session") {
      if (sessionFloating) {
        if (!sessionOpen) setDock(layout => ({ ...showDockPane(layout, id), expanded: null, focused: "conversation" }));
        setPeek(!sessionShown);
        return;
      }
      if (sessionShown) hidePane(id);
      else setDock(layout => ({ ...showDockPane(layout, id), expanded: null, focused: "conversation" }));
      return;
    }
    if (visible.has(id) && (compact ? focused === id : !expanded || expanded === id)) { hidePane(id); return; }
    if (id === "browser") {
      const tab = state.tabs.find(tab => tab.kind === "browser" && tab.id === state.browserActive) ?? state.tabs.find(tab => tab.kind === "browser");
      if (tab) update(state => panelReducer(state, { type: "select", id: tab.id }));
      else void openPage();
    } else openTool(id);
  };
  useEffect(() => {
    if (!covered) return;
    const fill = expanded ?? focused;
    const root = mainRef.current;
    const targets = [...(root?.querySelectorAll<HTMLElement>(":scope > :is(.app, .chat-layout) > :is(.main, .chat-main, .tablet-main), :scope > .app > .compact-shell") ?? [])];
    if (!targets.length && root) targets.push(root);
    const previous = document.activeElement as HTMLElement | null;
    const restore = previous && (targets.some(target => target.contains(previous)) || [...panes.current].some(([id, element]) => id !== fill && element.contains(previous)));
    const inert = targets.map(target => target.hasAttribute("inert"));
    targets.forEach(target => target.setAttribute("inert", ""));
    if (restore) panes.current.get(fill)?.focus();
    return () => {
      targets.forEach((target, index) => { if (!inert[index]) target.removeAttribute("inert"); });
      if (restore && previous.isConnected && panes.current.get(fill)?.contains(document.activeElement)) previous.focus();
    };
  }, [covered, expanded, focused, mainRef, scope]);
  useEffect(() => {
    if (!sessionShown || !sessionFloating) return;
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape" || target?.closest('[role="menu"], [role="dialog"]')) return;
        event.preventDefault();
        if (panes.current.get("session")?.contains(document.activeElement)) resize.appRef.current?.querySelector<HTMLElement>('[data-pane-toggle="session"]')?.focus();
        setPeek(false);
      } else if (!target?.closest('[data-dock-pane="session"], [data-pane-toggle="session"], [role="menu"], [role="dialog"], .ds-popover')) setPeek(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismiss); };
  });
  const menu = (id: string) => [
    ...(["left", "right", "top", "bottom"] as DockSide[]).map(side => ({ label: `Move ${side}`, onClick: () => setDock(layout => moveDockPane(layout, id, side)) })),
    { label: "Fill", onClick: () => setDock(layout => ({ ...layout, expanded: id })) },
    { label: "Tile", onClick: () => setDock(layout => ({ ...layout, expanded: null, ...(compact ? { focused: "conversation" } : {}) })) },
  ];
  // The browser lists its pane actions in the page menu, so its header carries no second overflow button.
  const browserPaneActions = [...(["left", "right", "top", "bottom"] as DockSide[]).map((side, index) => ({ label: `Move pane ${index < 2 ? side : `to ${side}`}`, onClick: () => setDock(layout => moveDockPane(layout, "browser", side)) })), { label: "Fill window", onClick: () => setDock(layout => ({ ...layout, expanded: "browser" })) }, { label: "Tile panes", onClick: () => setDock(layout => ({ ...layout, expanded: null, ...(compact ? { focused: "conversation" } : {}) })) }];
  const addBrowserContext = onBrowserContext ? (context: BrowserContext) => {
    if (expanded === "browser" || compact && focused === "browser") flushSync(() => setDock(layout => ({ ...layout, expanded: null, focused: "conversation" })));
    onBrowserContext(context);
  } : undefined;
  const browserTabs = state.tabs.filter(tab => tab.kind === "browser");
  const selectedBrowser = browserTabs.find(tab => tab.id === state.browserActive) ?? browserTabs[0];
  useLayoutEffect(() => {
    const request = closedTabFocus.current;
    if (!request || browserTabs.some(tab => tab.id === request.id)) return;
    closedTabFocus.current = null;
    const buttons = [...(browserTabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const target = buttons.find(button => button.dataset.browserTab === request.next) ?? buttons[0];
    if (target) target.focus();
    else (resize.appRef.current?.querySelector<HTMLElement>('[data-pane-toggle="browser"]') ?? resize.appRef.current?.querySelector<HTMLElement>('.dock-toolbar [aria-label="Actions for View options"]'))?.focus();
  }, [browserTabs, resize.appRef]);
  const closeBrowserTab = (tab: typeof browserTabs[number]) => {
    if (panes.current.get("browser")?.contains(document.activeElement)) {
      const index = browserTabs.findIndex(page => page.id === tab.id);
      closedTabFocus.current = { id: tab.id, next: (browserTabs[index + 1] ?? browserTabs[index - 1])?.id };
    }
    void close(tab);
  };
  const browserTabStop = browserTabFocus?.selection === selectedBrowser?.id && browserTabs.some(tab => tab.id === browserTabFocus.id) ? browserTabFocus.id : selectedBrowser?.id;
  const launchers = [
    ...tools.filter(tool => tool.id !== "browser").sort((a, b) => (toolOrder.indexOf(a.id) + 1 || 99) - (toolOrder.indexOf(b.id) + 1 || 99))
      .map(tool => ({ id: tool.id, label: tool.label, icon: toolIcons[tool.id] ?? LayoutGrid, shortcut: tool.shortcut ?? defaultShortcuts[tool.id], onOpen: () => { if (!visible.has(tool.id)) toggle(tool.id); } })),
    { id: "tile", label: "Tile panes", icon: LayoutGrid, onOpen: () => setDock(layout => ({ ...layout, expanded: null, ...(compact ? { focused: "conversation" } : {}) })) },
  ];
  const content = [
    ...(sessionRail ? [{ id: "session", label: "Session rail", content: sessionRail }] : []),
    ...tools,
    ...(features.browser && mounted.current.ids.has("browser") ? [{ id: "browser", label: "Browser", content: <BrowserPane embedded tools={launchers} paneActions={browserPaneActions} onBrowserContext={addBrowserContext} searchUrl={searchUrl} agentActive={browser.agentActive} onTakeOver={browser.agentActive ? browser.takeOver : onInterrupt} onClose={() => hidePane("browser")} /> }] : []),
  ];
  const measurement = <div key="dock-measurement" className="dock-stage" ref={stage} aria-hidden="true" />;
  return <div className={`workspace-shell dock-workspace${titlebarPane ? " has-titlebar-pane" : ""}${sessionShown ? " has-session" : ""}${sessionFloating ? " session-floating" : ""}${compact ? " is-compact" : ""}${layout.sidebarOverlay ? " sidebar-overlay" : ""}${covered ? " panel-expanded" : ""}`} ref={resize.appRef} style={{
    "--right-panel-width": "0px", "--sidebar-width": `${layout.sidebarWidth}px`, "--dock-titlebar-pane-w": titlebarPane && browserBox ? browserBox.w / 100 : 0, "--layout-sidebar-column": layout.sidebarColumn ? "var(--sidebar-width)" : "0px",
    "--dock-conversation-x": (conversation?.x ?? 0) / 100, "--dock-conversation-y": `${conversation?.y ?? 0}%`, "--dock-conversation-width": (conversation?.w ?? 100) / 100, "--dock-conversation-height": `${conversation?.h ?? 100}%`,
  } as CSSProperties}>
    <header id="titlebar" className="workspace-titlebar" data-tauri-drag-region {...reorderPane("conversation", scope, visible.has("conversation") && !covered, false)}>
      <div className="titlebar-navigation" data-tauri-drag-region="false"><IconButton className="ghost" aria-label="Back" disabled={!onNavigate || historyIndex === 0} onClick={() => navigate(historyIndex - 1)}><ArrowLeft aria-hidden /></IconButton><IconButton className="ghost" aria-label="Forward" disabled={!onNavigate || historyIndex >= history.current.length - 1} onClick={() => navigate(historyIndex + 1)}><ArrowRight aria-hidden /></IconButton><SidebarCollapseButton /></div>
      <div className="titlebar-title" data-tauri-drag-region><span title={title}>{title}</span></div>
      {titleActions && <div className="titlebar-actions">{titleActions}</div>}
      <div className="titlebar-thread-tools" id={TITLEBAR_THREAD_TOOLS_ID} data-tauri-drag-region="false" />
      {/* Thread actions sit before the pane toggles, so the panel toggle ends the bar in every mode, as in Chat and Work. */}
      {actions.length > 0 && <RowMenu label="thread" size="md" actions={actions}><span /></RowMenu>}
      <div className="dock-toolbar" role="toolbar" aria-label="Workspace views" data-tauri-drag-region="false">
        {compact && <IconButton className="ghost" aria-label="Show conversation" title="Conversation" aria-pressed={focused === "conversation"} onClick={() => setDock(layout => ({ ...layout, expanded: null, focused: "conversation" }))}><MessageSquare aria-hidden /></IconButton>}
        {sessionRail && <IconButton className="ghost" data-pane-toggle="session" aria-label="Session rail" title="Session rail" aria-expanded={sessionShown} aria-pressed={sessionShown} onClick={() => toggle("session")}><PanelRight aria-hidden /></IconButton>}
        {/* Terminal and Changes are always one click away; Browser and Files show a toggle only while open and otherwise live in View options. */}
        {(() => {
          const shownTools = quickTools.filter(tool => available.has(tool.id) && (!secondaryTools.has(tool.id) || visible.has(tool.id)));
          // Alone (Code home), the browser toggle opens the right panel and its tools: show it as the panel toggle Chat and Work use.
          const panelOnly = !sessionRail && !compact && shownTools.length === 1 && shownTools[0].id === "browser";
          return shownTools.map(tool => { const asPanel = panelOnly && tool.id === "browser"; const Icon = asPanel ? PanelRight : tool.icon; return <IconButton className="ghost" data-pane-toggle={tool.id} key={tool.id} aria-label={asPanel ? "Toggle side panel" : `Toggle ${tool.label}`} title={asPanel ? "Side panel" : tool.label} aria-pressed={visible.has(tool.id) && (!compact || focused === tool.id)} disabled={tool.id === "browser" && busy} onClick={() => toggle(tool.id)}><Icon aria-hidden /></IconButton>; });
        })()}
        {/* With the browser on, its new tab is where tools open; without it, they stay in this menu. */}
        {!features.browser && <RowMenu label="View options" size="md" portal icon={<LayoutGrid size={14} aria-hidden />} actions={[
          ...quickTools.filter(tool => secondaryTools.has(tool.id) && available.has(tool.id) && !visible.has(tool.id)).map(tool => ({ label: tool.label, onClick: () => toggle(tool.id) })),
          ...tools.filter(tool => !quickTools.some(quick => quick.id === tool.id)).map(tool => ({ label: tool.label, onClick: () => toggle(tool.id) })),
          { label: "Tile panes", onClick: () => setDock(layout => ({ ...layout, expanded: null, ...(compact ? { focused: "conversation" } : {}) })) },
        ]}><span /></RowMenu>}
      </div>
      <WindowCaptionControls />
    </header>
    <div className="workspace-body dock-body">
      <div className="workspace-main" ref={mainRef}>{children}</div>
      <div className="dock-session-space" ref={sessionSpace} aria-hidden="true" />
      {/* Moving existing panes past this keyed anchor refreshes WebKit's native AX children on expansion without remounting live content. */}
        {[...(expanded ? [measurement] : []), ...content.filter(pane => mounted.current.ids.has(pane.id)).map(pane => {
          const shown = pane.id === "session" ? sessionShown : visible.has(pane.id) && (compact ? focused === pane.id : !expanded || expanded === pane.id);
          const box = compact || expanded === pane.id ? full : geometry.panes[pane.id] ?? full;
          return <section className={`dock-pane${pane.id === titlebarPane ? " is-titlebar-pane" : ""}${expanded === pane.id ? " is-expanded" : ""}${pane.id === "session" ? ` dock-session-rail${sessionFloating ? " ds-popover" : ""}` : ""}`} key={pane.id} data-dock-pane={pane.id} aria-label={pane.label} hidden={!shown} tabIndex={-1} ref={element => { if (element) panes.current.set(pane.id, element); else panes.current.delete(pane.id); }} style={pane.id === "session" ? undefined : pane.id === titlebarPane ? lifted(box) : position(box)}>
            {pane.id !== "session" && <header className="dock-pane-header" {...reorderPane(pane.id, scope, shown, pane.id !== "conversation")}>{pane.id === "browser" ? <><div className="dock-browser-tabs" ref={browserTabsRef} role="tablist" aria-label="Browser pages">{browserTabs.map(tab => <div className="dock-browser-tab" key={tab.id}><button id={`${browserContentId}-${tab.id}`} role="tab" aria-description={pageStatusText(pageStatuses[tab.target ?? ""]) || undefined} title={tab.url} data-browser-tab={tab.id} aria-controls={browserContentId} aria-selected={selectedBrowser?.id === tab.id} tabIndex={browserTabStop === tab.id ? 0 : -1} onFocus={() => setBrowserTabFocus({ id: tab.id, selection: selectedBrowser?.id })} onClick={event => { event.currentTarget.focus(); update(state => panelReducer(state, { type: "select", id: tab.id })); }} onKeyDown={event => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); closeBrowserTab(tab); return; }
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = browserTabs.findIndex(page => page.id === tab.id);
              const next = event.key === "Home" ? 0 : event.key === "End" ? browserTabs.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + browserTabs.length) % browserTabs.length;
              browserTabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}><BrowserTabIcon status={!tab.url || tab.url === "about:blank" ? undefined : pageStatuses[tab.target ?? ""]} /><span>{tabLabel(tab)}</span></button><IconButton aria-label={`Close ${tab.title}`} onClick={() => closeBrowserTab(tab)}><X aria-hidden /></IconButton></div>)}</div><PanelTabList tabs={browserTabs} active={selectedBrowser?.id} statuses={pageStatuses} label="All browser tabs" onSelect={id => update(s => panelReducer(s, { type: "select", id }))} /><IconButton aria-label="New browser tab" disabled={busy} onClick={() => { void openPage(); }}><Plus aria-hidden /></IconButton></> : <strong>{pane.label}</strong>}
              <RowMenu label={`${pane.label} pane`} portal actions={menu(pane.id)}><IconButton className="ghost" aria-label={`${expanded === pane.id ? "Restore" : "Expand"} ${pane.label}`} onClick={() => setDock(layout => ({ ...layout, expanded: layout.expanded === pane.id ? null : pane.id }))}>{expanded === pane.id ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}</IconButton></RowMenu>
              <IconButton className="ghost" aria-label={`Close ${pane.label} pane`} onClick={() => hidePane(pane.id)}><X aria-hidden /></IconButton>
            </header>}
            <div className="dock-pane-content" {...(pane.id === "browser" ? { id: browserContentId, role: "tabpanel", "aria-labelledby": selectedBrowser ? `${browserContentId}-${selectedBrowser.id}` : undefined } : {})}><DiagnosticBoundary panel={pane.id}>{pane.content}</DiagnosticBoundary></div>
          </section>;
        }), ...(!expanded ? [measurement] : [])]}
        {!expanded && !compact && geometry.splits.map(({ node, box }, index) => {
          const horizontal = node.axis === "horizontal";
          const style: CSSProperties = horizontal
            ? { ...position({ ...box, x: box.x + box.w * node.ratio }), width: 8, transform: "translateX(-4px)" }
            : { ...position({ ...box, y: box.y + box.h * node.ratio }), height: 8, transform: "translateY(-4px)" };
          return <div key={node.id} data-dock-split={node.id} className={`dock-divider ${horizontal ? "is-horizontal" : "is-vertical"}`} role="separator" aria-label={`Resize dock split ${index + 1}`} aria-orientation={horizontal ? "vertical" : "horizontal"} aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(node.ratio * 100)} tabIndex={0} style={style} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
            event.preventDefault(); const ratio = event.key === "Home" ? .15 : event.key === "End" ? .85 : node.ratio + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -.05 : .05);
            setDock(layout => ({ ...layout, tree: resizeDockSplit(layout.tree, node.id, ratio) }));
          }} onPointerDown={event => {
            const bounds = stage.current?.getBoundingClientRect(); if (!bounds || !bounds.width || !bounds.height) return;
            const root = resize.appRef.current;
            if (!root) return;
            let ratio = node.ratio;
            const dividers = [...root.querySelectorAll<HTMLElement>("[data-dock-split]")];
            const place = (element: HTMLElement, box: DockBox, axis?: "horizontal" | "vertical") => {
              element.style.setProperty("--dock-box-x", String(box.x / 100));
              element.style.setProperty("--dock-box-width", String(box.w / 100));
              // React won't rewrite top/height after the drag when its props are unchanged, so keep the titlebar lift here.
              const style = element.classList.contains("is-titlebar-pane") ? lifted(box) : position(box);
              element.style.top = String(style.top);
              if (axis !== "vertical") element.style.height = String(style.height);
            };
            startResize(event, horizontal ? "col-resize" : "row-resize", event => {
              ratio = Math.min(.85, Math.max(.15, horizontal ? ((event.clientX - bounds.left) / bounds.width * 100 - box.x) / box.w : ((event.clientY - bounds.top) / bounds.height * 100 - box.y) / box.h));
              const next = dockGeometry(resizeDockSplit(tree, node.id, ratio));
              for (const [id, box] of Object.entries(next.panes)) {
                if (id === "conversation") {
                  root.style.setProperty("--dock-conversation-x", String(box.x / 100));
                  root.style.setProperty("--dock-conversation-width", String(box.w / 100));
                  root.style.setProperty("--dock-conversation-y", `${box.y}%`);
                  root.style.setProperty("--dock-conversation-height", `${box.h}%`);
                } else { const pane = panes.current.get(id); if (pane) place(pane, box); }
                // The titlebar reserves the lifted pane's width for its toolbar; move it with the pane, not on release.
                if (id === titlebarPane) root.style.setProperty("--dock-titlebar-pane-w", String(box.w / 100));
              }
              for (const { node, box } of next.splits) {
                const divider = dividers.find(element => element.dataset.dockSplit === node.id);
                if (divider) {
                  place(divider, node.axis === "horizontal" ? { ...box, x: box.x + box.w * node.ratio } : { ...box, y: box.y + box.h * node.ratio }, node.axis);
                  divider.setAttribute("aria-valuenow", String(Math.round(node.ratio * 100)));
                }
              }
            }, () => setDock(layout => ({ ...layout, tree: resizeDockSplit(layout.tree, node.id, ratio) })));
          }} />;
        })}
      {error && <p className="dock-error" role="alert">{error}</p>}
    </div>
  </div>;
}
