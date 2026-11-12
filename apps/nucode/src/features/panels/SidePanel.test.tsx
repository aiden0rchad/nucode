// @vitest-environment jsdom
import { assertRowAlignment } from "@/test/rowAlignment.mjs";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setupPointerEvents } from "@/test/pointerEvents";
import { WorkspaceShell, type PanelTool } from "./SidePanel";
import { panelReducer, readPanel, type PanelState } from "./panelState";
import { browserNativeBounds, browserRequest, subscribeBrowser } from "@services/tauri";
import type { MenuViewAction } from "@services/events";
import type { BrowserState } from "@/features/browser/browser";
import { useSidebarToggles } from "@/features/layout/hooks/useSidebarToggles";
import { useSidePanelState } from "@/features/app/hooks/useSidePanelState";

vi.mock("@services/tauri", () => ({ browserRequest: vi.fn(), subscribeBrowser: vi.fn(), openBrowserDownloads: vi.fn(), browserNativeBounds: vi.fn().mockResolvedValue(undefined) }));
const menu = vi.hoisted(() => ({ view: (_action: MenuViewAction) => {} }));
vi.mock("@services/events", () => ({ subscribeMenuViewAction: (listener: typeof menu.view) => { menu.view = listener; return () => { menu.view = () => {}; }; }, subscribeAppServerEvents: () => () => {} }));
setupPointerEvents();

let host: BrowserState;
let callbacks: Set<(state: BrowserState) => void>;
const tools: PanelTool[] = [
  { id: "git", label: "Changes", shortcut: "⌃⇧G", content: <p>Changed files</p> },
  { id: "terminal", label: "Terminal", shortcut: "⌃`", content: <p>Terminal session</p> },
  { id: "files", label: "Files", shortcut: "⌘P", content: <p>Project files</p> },
  { id: "sidechat", label: "Side chat", shortcut: "⇧⌘K", content: <p>Side conversation</p> },
  { id: "agents", label: "Agents", content: <p>Agent tree</p> },
  { id: "prompts", label: "Prompts", content: <p>Saved prompts</p> },
];
const shell = (scope = "code:one", items = tools) => <WorkspaceShell scope={scope} title="A thread" tools={items} onInterrupt={() => {}}><p>Conversation</p></WorkspaceShell>;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); vi.mocked(browserNativeBounds).mockResolvedValue(undefined); host = { tabs: [], active: "" }; callbacks = new Set();
  vi.mocked(subscribeBrowser).mockImplementation(async callback => { callbacks.add(callback); callback(host); return () => { callbacks.delete(callback); }; });
  vi.mocked(browserRequest).mockImplementation(async request => {
    if (request.action === "new") { const id = `page-${host.tabs.length + 1}`; host = { tabs: [...host.tabs, { id, title: "New page", url: "about:blank", loading: false }], active: id }; }
    if (request.action === "navigate") host = { ...host, tabs: host.tabs.map(tab => tab.id === host.active ? { ...tab, title: new URL(String(request.url)).hostname, url: String(request.url) } : tab) };
    if (request.action === "activate") host = { ...host, active: String(request.id) };
    if (request.action === "close") host = { ...host, tabs: host.tabs.filter(tab => tab.id !== request.id) };
    callbacks.forEach(callback => callback(host));
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { assertRowAlignment(document.body); cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each([false, true])("reveals the native agent page once per turn and respects dismissal (dock: %s)", async dock => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useSidePanelState({ scope: "code:one", tools, dock }));
  const publish = (agent: boolean) => act(() => {
    host = { backend: "native", agent, active: "agent-page", tabs: [{ id: "agent-page", title: "Docs", url: "https://example.test/", loading: false }] };
    callbacks.forEach(callback => callback(host));
  });
  publish(true);
  expect(result.current.state).toMatchObject({ open: true, active: "agent-page", tabs: [{ id: "agent-page", target: "agent-page", kind: "browser" }] });
  act(() => result.current.update(s => ({ ...s, open: false })));
  publish(true);
  expect(result.current.state.open).toBe(false);
  publish(false);
  act(() => vi.advanceTimersByTime(4999));
  publish(true);
  expect(result.current.state.open).toBe(false);
  publish(false);
  act(() => vi.advanceTimersByTime(3000));
  publish(false); // Polls must not restart the idle timer.
  act(() => vi.advanceTimersByTime(2000));
  publish(true);
  expect(result.current.state.open).toBe(true);
  expect(result.current.state.tabs).toHaveLength(1);
  await act(async () => {});
});
it.each([false, true])("selects an existing native page over another panel tab without duplicating it (dock: %s)", async dock => {
  host = { backend: "native", agent: false, active: "native-page", tabs: [{ id: "native-page", title: "Docs", url: "https://example.test/", loading: false }] };
  localStorage.setItem("nucode.panel.code:one", JSON.stringify({ open: true, active: "git", tabs: [{ id: "git", kind: "git", title: "Changes" }, { id: "saved-page", kind: "browser", title: "Docs", target: "native-page", url: "https://example.test/" }] }));
  const { result } = renderHook(() => useSidePanelState({ scope: "code:one", tools, dock }));
  act(() => { host = { ...host, agent: true }; callbacks.forEach(callback => callback(host)); });
  expect(result.current.state.active).toBe("saved-page");
  expect(result.current.state.tabs).toHaveLength(2);
  act(() => result.current.openTool("git"));
  act(() => callbacks.forEach(callback => callback(host)));
  expect(result.current.state.active).toBe("git");
  await act(async () => {});
});
it("waits for the agent's first native page before revealing the panel", async () => {
  host = { backend: "native", agent: true, active: "", tabs: [] };
  const { result } = renderHook(() => useSidePanelState({ scope: "code:one", tools }));
  expect(result.current.state.open).toBe(false);
  await act(async () => {
    host = { ...host, active: "page", tabs: [{ id: "page", title: "Docs", url: "https://example.test/", loading: false }] };
    callbacks.forEach(callback => callback(host));
  });
  expect(result.current.state).toMatchObject({ open: true, active: "page" });
});
it.each(["chat:one", "code:one"])("does not auto-open outside native code browsing (%s)", scope => {
  host = { active: "page", agent: true, ...(scope.startsWith("chat:") ? { backend: "native" as const } : {}), tabs: [{ id: "page", title: "Docs", url: "https://example.test/", loading: false }] };
  const { result } = renderHook(() => useSidePanelState({ scope, tools }));
  expect(result.current.state.open).toBe(false);
});
it("opens the browser without moving composer focus even in an overlay", async () => {
  vi.stubGlobal("innerWidth", 960);
  render(<WorkspaceShell scope="code:one" title="Thread" tools={tools} onInterrupt={() => {}}><input aria-label="Composer" /></WorkspaceShell>);
  const composer = screen.getByLabelText("Composer");
  composer.focus();
  act(() => {
    host = { backend: "native", agent: true, active: "blank", tabs: [{ id: "blank", title: "New page", url: "about:blank", loading: false }] };
    callbacks.forEach(callback => callback(host));
  });
  await waitFor(() => expect(readPanel("code:one").open).toBe(true));
  expect(document.activeElement).toBe(composer);
  expect(composer.closest("[inert]")).toBeNull();
  fireEvent.keyDown(composer, { key: "Escape" });
  expect(readPanel("code:one").open).toBe(false);
  act(() => callbacks.forEach(callback => callback(host)));
  expect(readPanel("code:one").open).toBe(false);
});
it.each([false, true])("carries a draft's tabs and native browser into its new thread (dock: %s)", async dock => {
  host = { tabs: [{ id: "docs-page", title: "Docs", url: "https://docs.example/", loading: false }], active: "docs-page" };
  const state: PanelState = { tabs: [{ id: "docs", kind: "browser", title: "Docs", url: host.tabs[0].url, target: "docs-page" }, { id: "terminal", kind: "terminal", title: "Terminal" }], active: "docs", open: true, ...(dock ? { browserActive: "docs", dock: { tree: { type: "split", id: "split", axis: "horizontal", ratio: .6, first: { type: "pane", id: "conversation" }, second: { type: "pane", id: "browser" } }, expanded: null, focused: "browser" } } : {}) };
  localStorage.setItem("nucode.panel.code:workspace:", JSON.stringify(state));
  const thread = (scope: string) => <WorkspaceShell scope={scope} dock={dock} title="Thread" tools={tools} onInterrupt={() => {}}><p>Conversation</p></WorkspaceShell>;
  const view = render(thread("code:workspace:"));
  await waitFor(() => expect(browserRequest).toHaveBeenCalledWith({ action: "activate", id: "docs-page" }));
  vi.mocked(browserRequest).mockClear();
  view.rerender(thread("code:workspace:new"));
  await waitFor(() => expect(browserRequest).toHaveBeenCalledWith({ action: "activate", id: "docs-page" }));
  expect(readPanel("code:workspace:new")).toEqual(state);
  expect(readPanel("code:workspace:")).toEqual({ tabs: [], active: null, open: false });
  expect(vi.mocked(browserRequest).mock.calls.some(([request]) => request.action === "new")).toBe(false);
  view.rerender(thread("code:workspace:"));
  expect(readPanel("code:workspace:").tabs).toEqual([]);
});
it("keeps an existing thread's saved state when leaving a draft", () => {
  const draft = { tabs: [{ id: "terminal", kind: "terminal", title: "Terminal" }], active: "terminal", open: true };
  const existing = { tabs: [{ id: "git", kind: "git", title: "Changes" }], active: "git", open: true };
  localStorage.setItem("nucode.panel.code:workspace:", JSON.stringify(draft));
  localStorage.setItem("nucode.panel.code:workspace:existing", JSON.stringify(existing));
  const view = render(shell("code:workspace:"));
  view.rerender(shell("code:workspace:existing"));
  expect(screen.getByText("Changed files")).toBeTruthy();
  expect(readPanel("code:workspace:existing")).toEqual(existing);
  expect(readPanel("code:workspace:")).toEqual(draft);
});
it.each([
  ["code:workspace:old", "code:workspace:new"],
  ["code:workspace:", "code:other:new"],
  ["chat:workspace:", "chat:workspace:new"],
  ["work:workspace:", "work:workspace:new"],
])("does not transfer tabs from %s to %s", (from, to) => {
  const state = { tabs: [{ id: "terminal", kind: "terminal", title: "Terminal" }], active: "terminal", open: true };
  localStorage.setItem(`nucode.panel.${from}`, JSON.stringify(state));
  const view = render(shell(from));
  view.rerender(shell(to));
  expect(readPanel(to)).toEqual({ tabs: [], active: null, open: false });
  expect(readPanel(from)).toEqual(state);
});
it("opens the tool grid, keeps a shared title row, and persists tab selection, close and keyboard reorder per thread", async () => {
  const view = render(shell());
  const titlebar = screen.getByRole("button", { name: "Toggle side panel" }).closest("header")!;
  expect(titlebar.hasAttribute("data-tauri-drag-region")).toBe(true);
  expect(within(titlebar).getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  for (const tool of tools) expect(screen.getByRole("button", { name: new RegExp(tool.label) })).toBeTruthy();
  expect(screen.getByText("⌃⇧G")).toBeTruthy();
  expect(screen.getByText("⌃`")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Changes/ }));
  fireEvent.click(screen.getByRole("button", { name: "New panel tab" }));
  fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
  fireEvent.keyDown(screen.getByRole("tab", { name: "Terminal" }), { key: "ArrowLeft", altKey: true });
  expect(readPanel("code:one").tabs.map(tab => tab.id)).toEqual(["terminal", "git"]);
  for (const [key, order] of [["ArrowRight", ["git", "terminal"]], ["Home", ["terminal", "git"]], ["End", ["git", "terminal"]], ["ArrowLeft", ["terminal", "git"]]] as const) {
    fireEvent.keyDown(screen.getByRole("tab", { name: "Terminal" }), { key, altKey: true });
    expect(readPanel("code:one").tabs.map(tab => tab.id)).toEqual(order);
  }
  view.rerender(shell("code:two"));
  expect(screen.queryByRole("tab")).toBeNull();
  view.rerender(shell());
  expect(screen.getByRole("tab", { name: "Terminal", selected: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close Terminal" }));
  expect(readPanel("code:one").tabs.map(tab => tab.id)).toEqual(["git"]);
  view.unmount(); render(shell());
  expect(screen.getByRole("tab", { name: "Changes", selected: true })).toBeTruthy();
  expect(document.querySelector(".panel-tabs, .browser-dock")).toBeNull();
});
it("opens a URL as its own tab, switches browser pages and restores a missing host target", async () => {
  const view = render(shell());
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.change(screen.getByRole("textbox", { name: "URL or search" }), { target: { value: "example.com" } });
  fireEvent.submit(screen.getByRole("textbox", { name: "URL or search" }).closest("form")!);
  await screen.findByRole("tab", { name: "example.com" });
  expect(browserRequest).toHaveBeenCalledWith({ action: "navigate", url: "https://example.com/" });
  await waitFor(() => expect(readPanel("code:one").tabs[0]).toMatchObject({ target: "page-1", url: "https://example.com/" }));
  fireEvent.click(screen.getByRole("button", { name: "New panel tab" }));
  fireEvent.click(screen.getByRole("button", { name: /New page/ }));
  await screen.findByRole("tab", { name: "New page" });
  fireEvent.click(screen.getByRole("tab", { name: "example.com" }));
  await waitFor(() => expect(host.active).toBe("page-1"));
  view.unmount(); host = { tabs: [], active: "" }; render(shell());
  await waitFor(() => expect(host.tabs[0]?.url).toBe("https://example.com/"));
  expect(screen.getByRole("button", { name: "Downloads" })).toBeTruthy();
});
it("reveals the selected tab and its close button after opening, switching and reopening the panel", async () => {
  const reveal = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = reveal;
  try {
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
    fireEvent.click(screen.getByRole("button", { name: /Changes/ }));
    const changes = screen.getByRole("tab", { name: "Changes" }).parentElement;
    expect(reveal.mock.instances[reveal.mock.instances.length - 1]).toBe(changes);
    fireEvent.click(screen.getByRole("button", { name: "New panel tab" }));
    fireEvent.click(screen.getByRole("button", { name: /New page/ }));
    const page = await screen.findByRole("tab", { name: "New page" });
    await waitFor(() => expect(reveal.mock.instances[reveal.mock.instances.length - 1]).toBe(page.parentElement));
    reveal.mockClear();
    act(() => { host = { ...host, tabs: host.tabs.map(tab => ({ ...tab, title: "A much longer page title" })) }; callbacks.forEach(callback => callback(host)); });
    expect(reveal.mock.instances[reveal.mock.instances.length - 1]).toBe(page.parentElement);
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(reveal.mock.instances[reveal.mock.instances.length - 1]).toBe(changes);
    fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
    reveal.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
    expect(reveal.mock.instances[reveal.mock.instances.length - 1]).toBe(changes);
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});
it("opens Task by default and validates corrupt saved tab data", () => {
  render(shell("work:task", [{ id: "task", label: "Task", content: <p>Plan and outputs</p> }]));
  expect(screen.getByRole("tab", { name: "Task", selected: true })).toBeTruthy();
  expect(screen.getByText("Plan and outputs")).toBeTruthy();
  localStorage.setItem("nucode.panel.invalid", '{"tabs":[null,{}, {"id":5}],"open":true}');
  expect(readPanel("invalid").tabs).toEqual([]);
  const initial = { tabs: [{ id: "a", kind: "files", title: "Files" }, { id: "b", kind: "git", title: "Changes" }], active: "a", open: true };
  expect(panelReducer(initial, { type: "reorder", id: "a", before: "b", after: true }).tabs.map(tab => tab.id)).toEqual(["b", "a"]);
});
it("registers the first agent-created page as a tab without covering Task", async () => {
  render(shell("work:task", [{ id: "task", label: "Task", content: <p>Plan and outputs</p> }]));
  await waitFor(() => expect(subscribeBrowser).toHaveBeenCalled());
  act(() => {
    host = { backend: "native", tabs: [{ id: "agent-page", title: "Dashboard", url: "http://127.0.0.1:8765/", ready: true, loading: false }], active: "agent-page", agent: true };
    callbacks.forEach(callback => callback(host));
  });
  expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Task", selected: true })).toBeTruthy();
  expect(screen.queryByLabelText("Native browser page")).toBeNull();
});
it("resizes with the keyboard and retains mounted tools when the panel is hidden", () => {
  vi.stubGlobal("innerWidth", 1600);
  render(shell()); fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize side panel" }), { key: "ArrowLeft" });
  expect(localStorage.getItem("codexmonitor.rightPanelWidth")).toBe("380");
  fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
  const session = screen.getByText("Terminal session");
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  expect(session.isConnected).toBe(true);
  act(() => window.dispatchEvent(new Event("nucode:panel-toggle")));
  expect(screen.getByRole("tab", { name: "Terminal" })).toBeTruthy();
});

it.each([[1860, "ArrowLeft", 1100], [1360, "ArrowRight", 580]])("uses the dynamic keyboard limit at %ipx", (width, key, expected) => {
  vi.stubGlobal("innerWidth", width);
  localStorage.setItem("codexmonitor.rightPanelWidth", "900");
  render(shell()); fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  const handle = screen.getByRole("separator", { name: "Resize side panel" });
  expect(handle.getAttribute("aria-valuemax")).toBe(String(width - 280 - 480));
  for (let i = 0; i < (key === "ArrowLeft" ? 11 : 1); i++) fireEvent.keyDown(handle, { key });
  expect(localStorage.getItem("codexmonitor.rightPanelWidth")).toBe(String(expected));
  expect(handle.getAttribute("aria-valuenow")).toBe(String(expected));
});

it("supplies the terminal preview fixture without starting a real process", () => {
  vi.stubEnv("MODE", "uipreview"); window.history.replaceState(null, "", "/?panel=terminal");
  expect(readPanel("code:workspace:thread")).toMatchObject({ open: true, active: "terminal", tabs: [{ kind: "terminal", title: "Terminal" }] });
});

it("restores the saved side-chat target when its tab is selected", async () => {
  localStorage.setItem("nucode.panel.code:one", JSON.stringify({ open: true, active: "sidechat", tabs: [{ id: "sidechat", kind: "sidechat", title: "Side chat", target: "fork-123" }] }));
  const open = vi.fn();
  render(shell("code:one", [{ id: "sidechat", label: "Side chat", content: <p>Side chat</p>, onOpen: open }]));
  await waitFor(() => expect(open).toHaveBeenCalledWith(expect.objectContaining({ target: "fork-123" })));
  expect(readPanel("code:one").tabs[0].target).toBe("fork-123");
});

it("synchronizes title-bar visibility with existing panel shortcuts and file polling", () => {
  function App() {
    const { rightPanelCollapsed, expandRightPanel } = useSidebarToggles({ isCompact: false });
    return <><output>{rightPanelCollapsed ? "collapsed" : "open"}</output><button onClick={expandRightPanel}>Expand existing panel</button>{shell()}</>;
  }
  render(<App />);
  expect(screen.getByRole("status").textContent).toBe("collapsed");
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  expect(screen.getByRole("status").textContent).toBe("open");
  fireEvent.click(screen.getByRole("button", { name: "Expand existing panel" }));
  expect(screen.getByRole("button", { name: "Toggle side panel" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByRole("button", { name: "Close side panel" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  expect(screen.getByRole("status").textContent).toBe("collapsed");
});

it("uses a dismissible overlay at 960px and returns to a column when enough space is available", () => {
  vi.stubGlobal("innerWidth", 960);
  const view = render(shell());
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  expect(screen.getByRole("dialog", { name: "Side panel" }).classList.contains("is-overlay")).toBe(true);
  expect(view.container.querySelector(".workspace-main")?.hasAttribute("inert")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss side panel" }));
  expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull();
  vi.stubGlobal("innerWidth", 1440); fireEvent(window, new Event("resize"));
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  expect(screen.getByRole("complementary", { name: "Side panel" }).classList.contains("is-overlay")).toBe(false);
  expect(screen.queryByRole("button", { name: "Dismiss side panel" })).toBeNull();
  vi.unstubAllGlobals();
});

it.each([235, 360, 900])("resizes a saved %ipx panel in overlay mode at 995px", savedWidth => {
  vi.stubGlobal("innerWidth", 995);
  vi.stubGlobal("innerHeight", 530);
  localStorage.setItem("codexmonitor.sidebarWidth", "280");
  localStorage.setItem("codexmonitor.rightPanelWidth", String(savedWidth));
  const view = render(shell());
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  const panel = screen.getByRole("dialog", { name: "Side panel" });
  const handle = screen.getByRole("separator", { name: "Resize side panel" });
  const initialWidth = Math.max(320, savedWidth);
  expect(handle.getAttribute("aria-valuenow")).toBe(String(initialWidth));
  expect(handle.getAttribute("aria-valuemin")).toBe("320");
  expect(handle.getAttribute("aria-valuemax")).toBe("915");
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = vi.fn(() => true);
  handle.releasePointerCapture = vi.fn();
  vi.spyOn(panel, "getBoundingClientRect").mockImplementation(() => ({ width: Number(handle.getAttribute("aria-valuenow")) }) as DOMRect);
  const drag = (clientX: number) => {
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, isPrimary: true, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX });
    fireEvent.pointerUp(handle, { pointerId: 1 });
  };
  drag(380);
  expect(handle.getAttribute("aria-valuenow")).toBe(String(Math.min(915, initialWidth + 120)));
  expect(view.container.querySelector<HTMLElement>(".workspace-shell")?.style.getPropertyValue("--right-panel-width")).toBe(`${Math.min(915, initialWidth + 120)}px`);
  drag(1500);
  expect(handle.getAttribute("aria-valuenow")).toBe("320");
  expect(panel.classList.contains("is-overlay")).toBe(true);
});

it("switches to overlay exactly when the docked space falls below 320px", () => {
  vi.stubGlobal("innerWidth", 1080);
  localStorage.setItem("codexmonitor.sidebarWidth", "280");
  render(shell());
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  const handle = screen.getByRole("separator", { name: "Resize side panel" });
  expect(screen.getByRole("complementary", { name: "Side panel" }).classList.contains("is-overlay")).toBe(false);
  expect(handle.getAttribute("aria-valuenow")).toBe("320");
  expect(handle.getAttribute("aria-valuemax")).toBe("320");
  vi.stubGlobal("innerWidth", 1079); fireEvent(window, new Event("resize"));
  expect(screen.getByRole("dialog", { name: "Side panel" }).classList.contains("is-overlay")).toBe(true);
  expect(handle.getAttribute("aria-valuenow")).toBe("360");
  expect(handle.getAttribute("aria-valuemax")).toBe("999");
  vi.stubGlobal("innerWidth", 1080); fireEvent(window, new Event("resize"));
  expect(screen.getByRole("complementary", { name: "Side panel" }).classList.contains("is-overlay")).toBe(false);
  expect(handle.getAttribute("aria-valuenow")).toBe("320");
  expect(localStorage.getItem("codexmonitor.rightPanelWidth")).toBe("360");
});
it("automatically collapses the sidebar below 760px and allows the title toggle to reopen it", () => {
  vi.stubGlobal("innerWidth", 740);
  render(shell());
  expect(localStorage.getItem("codexmonitor.sidebarCollapsed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(localStorage.getItem("codexmonitor.sidebarCollapsed")).toBe("false");
  vi.unstubAllGlobals();
});

it("removes disabled panel tools and browser subscriptions live", async () => {
  const { FeatureSettings } = await import("@settings/features");
  const view = render(shell());
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.click(screen.getByRole("button", { name: /Changes/ }));
  view.rerender(<FeatureSettings.Provider value={{ features: { git: false, terminal: false, subagents: false, sideChats: false, browser: false } } as import("@/types").AppSettings}>{shell()}</FeatureSettings.Provider>);
  for (const name of [/Changes/, /Terminal/, /Agents/, /Side chat/, /New page/]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Changes" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "URL or search" })).toBeNull();
  await waitFor(() => expect(callbacks.size).toBe(0));
  vi.mocked(browserRequest).mockClear();
  fireEvent.keyDown(window, { key: "b", metaKey: true, shiftKey: true });
  expect(browserRequest).not.toHaveBeenCalled();
});

it("expands beside an interactive sidebar without losing the active tab, tool state or saved width", () => {
  vi.stubGlobal("innerWidth", 1600);
  localStorage.setItem("codexmonitor.rightPanelWidth", "540");
  const view = render(<WorkspaceShell scope="code:one" title="A thread" tools={[...tools.filter(t => t.id !== "terminal"), { id: "terminal", label: "Terminal", content: <input aria-label="Terminal command" defaultValue="" /> }]} onInterrupt={() => {}}>
    <div className="app"><aside className="sidebar"><button>Sidebar thread</button></aside><main className="main"><button>Conversation action</button></main></div>
  </WorkspaceShell>);
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
  const panel = screen.getByRole("complementary", { name: "Side panel" });
  const input = screen.getByRole("textbox", { name: "Terminal command" });
  fireEvent.change(input, { target: { value: "npm run dev" } });
  const conversation = screen.getByRole("button", { name: "Conversation action" }).closest("main")!;
  const sidebar = screen.getByRole("button", { name: "Sidebar thread" });
  const saved = readPanel("code:one");
  fireEvent.click(screen.getByRole("button", { name: "Expand side panel" }));
  expect(screen.getByRole("complementary", { name: "Side panel" })).toBe(panel);
  expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Dismiss side panel" })).toBeNull();
  expect(screen.queryByRole("separator", { name: "Resize side panel" })).toBeNull();
  expect(conversation.hasAttribute("inert")).toBe(true);
  expect(sidebar.closest("[inert]")).toBeNull();
  sidebar.focus(); expect(document.activeElement).toBe(sidebar);
  fireEvent.keyDown(sidebar, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Contract side panel" })).toBeTruthy();
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  screen.getByRole("button", { name: "Contract side panel" }).dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);
  expect(screen.getByRole("tab", { name: "Terminal", selected: true })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Terminal command" })).toBe(input);
  expect(readPanel("code:one")).toEqual(saved);
  expect(localStorage.getItem("codexmonitor.rightPanelWidth")).toBe("540");
  fireEvent.click(screen.getByRole("button", { name: "Contract side panel" }));
  expect(conversation.hasAttribute("inert")).toBe(false);
  expect(screen.getByRole("separator", { name: "Resize side panel" }).getAttribute("aria-valuenow")).toBe("540");
  expect((input as HTMLInputElement).value).toBe("npm run dev");
  expect(view.container.querySelector(".panel-expanded")).toBeNull();
});

it("updates the expanded sidebar boundary through collapse, resize and narrow windows without changing its normal width", () => {
  vi.stubGlobal("innerWidth", 1600);
  localStorage.setItem("codexmonitor.sidebarWidth", "320");
  localStorage.setItem("codexmonitor.rightPanelWidth", "520");
  const view = render(shell());
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
  fireEvent.click(screen.getByRole("button", { name: "Expand side panel" }));
  const column = () => {
    const value = view.container.querySelector<HTMLElement>(".workspace-shell")!.style.getPropertyValue("--layout-sidebar-column");
    return value === "var(--sidebar-width)" ? document.documentElement.style.getPropertyValue("--sidebar-width") : value;
  };
  expect(column()).toBe("320px");
  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" })); expect(column()).toBe("0px");
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" })); expect(column()).toBe("320px");
  act(() => { localStorage.setItem("codexmonitor.sidebarWidth", "420"); window.dispatchEvent(new Event("nucode:sidebar")); });
  expect(column()).toBe("420px");
  vi.stubGlobal("innerWidth", 360); fireEvent(window, new Event("resize"));
  expect(column()).toBe("0px");
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(column()).toBe("0px");
  expect(localStorage.getItem("codexmonitor.sidebarCollapsed")).toBe("false");
  expect(screen.getByRole("complementary", { name: "Side panel" }).getAttribute("aria-modal")).toBeNull();
  vi.stubGlobal("innerWidth", 1600); fireEvent(window, new Event("resize"));
  expect(column()).toBe("420px");
  expect(localStorage.getItem("codexmonitor.rightPanelWidth")).toBe("520");
  fireEvent.click(screen.getByRole("button", { name: "Contract side panel" }));
  expect(screen.getByRole("button", { name: "Expand side panel" })).toBeTruthy();
  expect(screen.getByRole("separator", { name: "Resize side panel" }).getAttribute("aria-valuenow")).toBe("520");
  expect(screen.getByRole("tab", { name: "Terminal", selected: true })).toBeTruthy();
});

it("keeps the active native browser mounted and reports new bounds when expanding and contracting", async () => {
  vi.stubGlobal("innerWidth", 1600);
  host = { backend: "native", active: "page-1", tabs: [{ id: "page-1", title: "Example", url: "https://example.com/", loading: false, ready: true }] };
  localStorage.setItem("nucode.panel.code:one", JSON.stringify({ open: true, active: "browser", tabs: [{ id: "browser", kind: "browser", title: "Example", url: "https://example.com/", target: "page-1" }] }));
  let rect = { x: 1240, y: 100, width: 360, height: 600 } as DOMRect;
  const frames = new Map<number, FrameRequestCallback>(); let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return this.classList.contains("browser-native-slot") ? rect : { x: 0, y: 0, width: 0, height: 0 } as DOMRect; });
  const frame = async () => act(async () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(0)); });
  render(shell());
  const slot = await screen.findByLabelText("Native browser page");
  await frame();
  expect(browserNativeBounds).toHaveBeenLastCalledWith("page-1", { x: 1240, y: 100, w: 360, h: 600 }, true);
  const initialRequests = vi.mocked(browserRequest).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Expand side panel" }));
  rect = { x: 280, y: 100, width: 1320, height: 600 } as DOMRect; await frame();
  expect(screen.getByLabelText("Native browser page")).toBe(slot);
  expect(browserNativeBounds).toHaveBeenLastCalledWith("page-1", { x: 280, y: 100, w: 1320, h: 600 }, true);
  fireEvent.click(screen.getByRole("button", { name: "Contract side panel" }));
  rect = { x: 1240, y: 100, width: 360, height: 600 } as DOMRect; await frame();
  expect(screen.getByLabelText("Native browser page")).toBe(slot);
  expect(browserNativeBounds).toHaveBeenLastCalledWith("page-1", { x: 1240, y: 100, w: 360, h: 600 }, true);
  expect(vi.mocked(browserNativeBounds).mock.calls.every(([, , visible]) => visible)).toBe(true);
  expect(vi.mocked(browserRequest).mock.calls.slice(initialRequests)).toEqual([]);
  expect(host.active).toBe("page-1");
});

it("excludes phone Projects and bottom navigation from focus until contraction while leaving title controls usable", () => {
  vi.stubGlobal("innerWidth", 360);
  render(<WorkspaceShell scope="code:phone" title="Phone thread" tools={tools} onInterrupt={() => {}}>
    <div className="app layout-phone"><div className="compact-shell"><div className="compact-panel"><aside className="sidebar"><button>Project thread</button></aside></div><nav><button>Projects</button></nav></div></div>
  </WorkspaceShell>);
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
  fireEvent.click(screen.getByRole("button", { name: "Expand side panel" }));
  const projects = screen.getByRole("button", { name: "Projects" });
  const project = screen.getByRole("button", { name: "Project thread" });
  expect(projects.closest("[inert]")).toBe(project.closest(".compact-shell"));
  expect(screen.getByRole("button", { name: "Toggle side panel" }).closest("[inert]")).toBeNull();
  expect(screen.getByRole("button", { name: "Contract side panel" }).closest("[inert]")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Contract side panel" }));
  // Normal narrow mode remains a dismissible overlay until closed.
  fireEvent.click(screen.getByRole("button", { name: "Dismiss side panel" }));
  expect(projects.closest("[inert]")).toBeNull();
  expect(project.closest("[inert]")).toBeNull();
  expect(screen.getByRole("tab", { name: "Terminal", hidden: true }).isConnected).toBe(true);
});

it("routes native View commands through the current panel and conversation history", async () => {
  const onNavigate = vi.fn();
  const view = render(<WorkspaceShell scope="chat:one" title="One" tools={tools} onNavigate={onNavigate} onInterrupt={() => {}}><p>Conversation</p></WorkspaceShell>);
  act(() => menu.view("back"));
  expect(onNavigate).not.toHaveBeenCalled();
  act(() => menu.view("toggle_side_panel"));
  expect(screen.getByRole("button", { name: "Toggle side panel" }).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /Changes/ }));
  act(() => menu.view("new_browser_tab"));
  await screen.findByRole("tab", { name: "New page", selected: true });
  act(() => menu.view("previous_tab"));
  expect(screen.getByRole("tab", { name: "Changes", selected: true })).toBeTruthy();
  act(() => menu.view("next_tab"));
  expect(screen.getByRole("tab", { name: "New page", selected: true })).toBeTruthy();
  view.rerender(<WorkspaceShell scope="chat:two" title="Two" tools={tools} onNavigate={onNavigate} onInterrupt={() => {}}><p>Conversation</p></WorkspaceShell>);
  act(() => menu.view("back"));
  expect(onNavigate).toHaveBeenLastCalledWith("chat:one");
  act(() => menu.view("forward"));
  expect(onNavigate).toHaveBeenLastCalledWith("chat:two");
  view.unmount();
  vi.mocked(browserRequest).mockClear();
  act(() => menu.view("new_browser_tab"));
  expect(browserRequest).not.toHaveBeenCalled();
});

it("switches duplicate-title tabs from the full list and shows live page status", async () => {
  host = { tabs: Array.from({ length: 9 }, (_, i) => ({ id: `host-${i}`, title: "Preview", url: `https://preview.test/${i}`, loading: i === 8 })), active: "host-0" };
  localStorage.setItem("nucode.panel.code:one", JSON.stringify({ open: true, active: "tab-0", tabs: host.tabs.map((page, i) => ({ id: `tab-${i}`, kind: "browser", title: page.title, url: page.url, target: page.id })) }));
  render(shell());
  const list = screen.getByRole("combobox", { name: "All panel tabs" });
  expect(within(list).getAllByRole("option")).toHaveLength(9);
  expect(within(list).getByRole("option", { name: /9\. Preview.*preview.test\/8.*Loading/ })).toBeTruthy();
  fireEvent.change(list, { target: { value: "tab-8" } });
  await waitFor(() => expect(host.active).toBe("host-8"));
  const selected = screen.getByRole("tab", { name: "Preview", selected: true });
  expect(selected.getAttribute("aria-description")).toBe("Loading");
  act(() => { host = { ...host, tabs: host.tabs.map(page => page.id === "host-8" ? { ...page, loading: false, error: "Connection refused" } : page) }; callbacks.forEach(callback => callback(host)); });
  expect(selected.getAttribute("aria-description")).toBe("Failed to load: Connection refused");
  expect(within(list).getByRole("option", { name: /Connection refused/ })).toBeTruthy();
  expect(JSON.stringify(readPanel("code:one"))).not.toContain("Connection refused");
});
it("keeps saved URLs, order and selection while restoring the selected page before lazy tabs", async () => {
  const tabs = [0, 1, 2].map(i => ({ id: `saved-${i}`, kind: "browser", title: `Saved ${i}`, url: `https://saved.test/${i}`, target: `old-${i}` }));
  localStorage.setItem("nucode.panel.code:one", JSON.stringify({ open: true, active: "saved-1", tabs }));
  const request = vi.mocked(browserRequest).getMockImplementation()!;
  let finish!: () => void;
  vi.mocked(browserRequest).mockImplementation(async input => {
    if (input.action === "navigate") await new Promise<void>(resolve => { finish = resolve; });
    return request(input);
  });
  render(shell());
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(readPanel("code:one").tabs.map(tab => [tab.id, tab.title, tab.url])).toEqual(tabs.map(tab => [tab.id, tab.title, tab.url]));
  expect(readPanel("code:one").active).toBe("saved-1");
  await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "All panel tabs" }), { target: { value: "saved-2" } }); });
  expect(host.tabs).toHaveLength(1);
  vi.mocked(browserRequest).mockImplementation(request);
  await act(async () => { finish(); });
  await waitFor(() => expect(host.tabs[0].url).toBe("https://saved.test/1"));
  await waitFor(() => expect(host.tabs[1]?.url).toBe("https://saved.test/2"));
  expect(readPanel("code:one").tabs.map(tab => tab.id)).toEqual(tabs.map(tab => tab.id));
});


it.each([
  ["Changes", "Terminal", "after"],
  ["Terminal", "Changes", "before"],
] as const)("reorders %s %s using horizontal pointer gestures without selecting the dragged tab", (sourceName, targetName, position) => {
  render(shell());
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.click(screen.getByRole("button", { name: /Changes/ }));
  fireEvent.click(screen.getByRole("button", { name: "New panel tab" }));
  fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
  const source = screen.getByRole("tab", { name: sourceName });
  const target = screen.getByRole("tab", { name: targetName });
  fireEvent.click(source);
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 10, clientY: 15 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 15 });
  fireEvent.click(target);
  expect(target.getAttribute("aria-selected")).toBe("true");
  const row = target.closest<HTMLElement>(".side-panel-tab")!;
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ left: 100, width: 100, right: 200, top: 0, bottom: 30, height: 30 } as DOMRect);
  const clientX = position === "before" ? 125 : 175;
  vi.mocked(document.elementFromPoint).mockReturnValue(target.querySelector("span"));
  fireEvent.pointerDown(source.querySelector("span")!, { button: 0, pointerId: 1, clientX: 10, clientY: 15 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX, clientY: 15 });
  expect(source.parentElement?.getAttribute("data-dragging")).toBe("true");
  expect(source.parentElement?.hasAttribute("draggable")).toBe(false);
  expect(row.dataset.dropEdge).toBe(position);
  fireEvent.pointerUp(window, { pointerId: 1, clientX, clientY: 15 });
  fireEvent.click(source);
  expect(target.getAttribute("aria-selected")).toBe("true");
  expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Terminal", "Changes"]);
  expect(readPanel("code:one").tabs.map(tab => tab.id)).toEqual(["terminal", "git"]);
});

it("never starts a tab drag from the close button and still closes on click", async () => {
  render(shell());
  fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
  fireEvent.click(screen.getByRole("button", { name: /Changes/ }));
  fireEvent.click(screen.getByRole("button", { name: "New panel tab" }));
  fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
  const close = screen.getByRole("button", { name: "Close Terminal" });
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByRole("tab", { name: "Changes" }));
  fireEvent.pointerDown(close.querySelector("svg")!, { button: 0, pointerId: 1, clientX: 10, clientY: 15 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 15 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 15 });
  expect(document.body.classList.contains("sidebar-reordering")).toBe(false);
  expect(readPanel("code:one").tabs.map(tab => tab.id)).toEqual(["git", "terminal"]);
  fireEvent.click(close);
  await waitFor(() => expect(readPanel("code:one").tabs.map(tab => tab.id)).toEqual(["git"]));
});
