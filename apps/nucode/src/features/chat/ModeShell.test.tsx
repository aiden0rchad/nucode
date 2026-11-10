// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { ModeShell, ModeSwitcher, modeShortcut, useModeSettings } from "./ModeShell";
import { getAppSettings, setWindowMode, windowSetMaterial, updateAppSettings } from "@services/tauri";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { applyTheme } from '@/features/themes/applyTheme';
import { ChainOfCommandControls, ComposerPolicyProvider } from "@/features/composer/components/ComposerPolicy";
import { defaultAgentPolicy, setAgentMode } from "@settings/registry";
import { builtins } from '@/features/themes/builtins';
vi.mock("@services/tauri", () => ({ getAppSettings: vi.fn(), setWindowMode: vi.fn().mockResolvedValue(undefined), themesList: vi.fn(async () => []), windowSetMaterial: vi.fn(async () => {}), updateAppSettings: vi.fn(async (settings: unknown) => settings) }));
vi.mock("@/features/onboarding/SetupWizard", () => ({ SetupWizard: () => null }));
vi.mock("@/features/work/WorkView", () => ({ WorkView: () => <><ModeSwitcher /><p>Work content</p><ChainOfCommandControls onConfigure={() => {}} /></> }));
vi.mock("./ChatView", () => ({ ChatView: () => <><ModeSwitcher /><p>Chat content</p><ChainOfCommandControls onConfigure={() => {}} /></> }));
vi.mock("@/features/evals/EvalsView", () => ({ EvalsView: ({full,initialRunId,onClose}:{full:boolean;initialRunId?:string;onClose:()=>void}) => <section aria-label="Full eval results"><p>{full?initialRunId:"compact"}</p><button onClick={onClose}>Close results</button></section> }));
vi.mock("@/features/layout/hooks/useWindowLabel", () => ({ useWindowLabel: () => "second-window" }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn(() => ({ setZoom: vi.fn().mockResolvedValue(undefined) })) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
/** Switches mode the way a person does: open the mode menu, then choose the mode. */
function pick(mode: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Mode: / }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: new RegExp(`^${mode}`) }));
}

it.each(["chat", "work"])("supports zoom and reset in %s without duplicating Code handlers", async mode => {
  const setZoom = vi.fn().mockResolvedValue(undefined);
  vi.mocked(getCurrentWebview).mockReturnValue({ setZoom } as unknown as ReturnType<typeof getCurrentWebview>);
  vi.mocked(getAppSettings).mockResolvedValue({ uiScale: 1.2, windowModes: { "second-window": mode } } as unknown as AppSettings);
  render(<ModeShell><ModeSwitcher /><p>Code content</p></ModeShell>);
  await screen.findByText(mode === "chat" ? "Chat content" : "Work content");
  expect(setZoom).toHaveBeenLastCalledWith(1.2);
  fireEvent.keyDown(window, { key: "-", metaKey: true });
  await waitFor(() => expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({ uiScale: 1.1 })));
  fireEvent.keyDown(window, { key: "0", metaKey: true });
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1));
  pick("Code");
  await screen.findByText("Code content");
  vi.mocked(updateAppSettings).mockClear();
  fireEvent.keyDown(window, { key: "+", metaKey: true });
  expect(updateAppSettings).not.toHaveBeenCalled();
});
it('keeps the cached theme while shell and code settings load', async () => {
  applyTheme(builtins.find(t => t.id === 'glass-dark')!);
  await act(async () => {});
  vi.mocked(windowSetMaterial).mockClear();
  let resolve!: (settings: AppSettings) => void;
  vi.mocked(getAppSettings).mockReturnValue(new Promise(done => { resolve = done; }));
  function LoadingCode() {
    useModeSettings(null);
    return <p>Code loading</p>;
  }
  render(<ModeShell><LoadingCode /></ModeShell>);
  await act(async () => {});
  expect(windowSetMaterial).not.toHaveBeenCalled();
  await act(async () => { resolve({ theme: 'glass-dark', windowModes: {} } as AppSettings); });
  expect(screen.getByText('Code loading')).toBeTruthy();
  expect(document.documentElement.dataset.themeId).toBe('glass-dark');
  expect(windowSetMaterial).not.toHaveBeenCalled();
});
it("opens the selected evaluation in the main area and returns to the previous mode",async()=>{
 vi.mocked(getAppSettings).mockResolvedValue({windowModes:{"second-window":"code"}} as unknown as AppSettings);
 render(<ModeShell><p>Code content</p></ModeShell>);
 await screen.findByText("Code content");
 act(()=>{window.dispatchEvent(new CustomEvent("nucode:evals-full",{detail:{runId:"eval-b"}}));});
 expect(screen.getByLabelText("Full eval results").textContent).toContain("eval-b");
 expect(screen.getByText("Code content").parentElement?.style.display).toBe("none");
 fireEvent.click(screen.getByRole("button",{name:"Close results"}));
 expect(screen.queryByLabelText("Full eval results")).toBeNull();
 expect(screen.getByText("Code content").parentElement?.style.display).toBe("contents");
});
describe("mode switching", () => {
  it("restores this window's mode and persists changes", async () => {
    vi.mocked(getAppSettings).mockResolvedValue({ theme: 'system', windowModes: { main: "code", "second-window": "chat" } } as unknown as AppSettings);
    render(<ModeShell><ModeSwitcher /><p>Code content</p></ModeShell>);
    expect(await screen.findByText("Chat content")).toBeTruthy();
    pick("Work");
    await waitFor(() => expect(setWindowMode).toHaveBeenCalledWith("work"));
    expect(await screen.findByText("Work content")).toBeTruthy();
    pick("Code");
    expect(await screen.findByText("Code content")).toBeTruthy();
  });
  it("lists each mode with what it is for and checks the current one", async () => {
    vi.mocked(getAppSettings).mockResolvedValue({ theme: 'system', windowModes: { "second-window": "code" } } as unknown as AppSettings);
    render(<ModeShell><ModeSwitcher /><p>Code content</p></ModeShell>);
    await screen.findByText("Code content");
    const trigger = screen.getByRole("button", { name: "Mode: Code" });
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map(item => item.textContent)).toEqual(["CodeBuild, debug and ship", "ChatAsk, learn and explore", "WorkHand off tasks that make files"]);
    expect(items[0]).toHaveProperty("ariaChecked", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("opens in the default mode when one is chosen", async () => {
    vi.mocked(getAppSettings).mockResolvedValue({ theme: 'system', defaultMode: "work", windowModes: { "second-window": "chat" } } as unknown as AppSettings);
    render(<ModeShell><ModeSwitcher /><p>Code content</p></ModeShell>);
    expect(await screen.findByText("Work content")).toBeTruthy();
  });
  it("reserves only unbound command-number shortcuts", () => {
    const event = new KeyboardEvent("keydown", { key: "2", metaKey: true });
    expect(modeShortcut(event, {} as AppSettings)).toBe("chat");
    expect(modeShortcut(event, { composerModelShortcut: "meta+2" } as AppSettings)).toBeUndefined();
    expect(modeShortcut(new KeyboardEvent("keydown", { key: "2", metaKey: true, shiftKey: true }), {} as AppSettings)).toBeUndefined();
  });
});

it("falls back to Code when a saved mode is disabled and hides both disabled segments", async () => {
  vi.mocked(getAppSettings).mockResolvedValue({ theme: 'system', windowModes: { "second-window": "chat" }, features: { chatMode: false, workMode: false } } as unknown as AppSettings);
  render(<ModeShell><ModeSwitcher /><p>Code content</p></ModeShell>);
  expect(await screen.findByText("Code content")).toBeTruthy();
  // With only Code available the mode is a plain title, not a menu.
  expect(screen.queryByRole("button", { name: /^Mode:/ })).toBeNull();
  expect(screen.getByText("Code", { selector: ".mode-menu-trigger" })).toBeTruthy();
  expect(setWindowMode).toHaveBeenCalledWith("code");
});

it("limits the Chain of Command picker to Code even with an enabled app policy", async () => {
  const policy = setAgentMode(defaultAgentPolicy, "chain-of-command");
  vi.mocked(getAppSettings).mockResolvedValue({ agentPolicy: policy, uiScale: 1, windowModes: { "second-window": "chat" } } as unknown as AppSettings);
  render(<ModeShell><ComposerPolicyProvider policy={policy} scope="Project · Demo" onChange={async () => {}}><ModeSwitcher /><p>Code content</p><ChainOfCommandControls onConfigure={() => {}} /></ComposerPolicyProvider></ModeShell>);
  await screen.findByText("Chat content");
  expect(screen.queryByRole("button", { name: "Chain of Command" })).toBeNull();
  pick("Work");
  await screen.findByText("Work content");
  expect(screen.queryByRole("button", { name: "Chain of Command" })).toBeNull();
  pick("Code");
  expect(await screen.findByRole("button", { name: "Chain of Command" })).toHaveProperty("ariaPressed", "true");
  expect(screen.getByRole("button", { name: "Configure Chain of Command" })).toBeTruthy();
});
