// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { SettingsServerSection } from "./SettingsServerSection";
import { SettingsBrowserSection } from "./SettingsBrowserSection";
import { SettingsShortcutsSection } from "./SettingsShortcutsSection";
import { SettingsDisclosureRow } from "@/features/design-system/components/settings/SettingsPrimitives";

vi.mock("@services/tauri", () => ({ browserPasswordsList: vi.fn().mockResolvedValue({ entries: [], never: [] }), browserPasswordSave: vi.fn(), browserPasswordDelete: vi.fn(), browserPasswordUnblock: vi.fn(), browserRequest: vi.fn() }));
afterEach(cleanup);

const server = (settings: Partial<AppSettings>, extra: Record<string, unknown> = {}) => render(<SettingsServerSection {...(({ ...{
  appSettings: { backendMode: "local", remoteBackendToken: null, keepDaemonRunningAfterAppClose: false, ...settings }, onUpdateAppSettings: vi.fn(), isMobilePlatform: false, mobileConnectBusy: false, mobileConnectStatusText: null, mobileConnectStatusError: false,
  remoteBackends: [], activeRemoteBackendId: null, remoteStatusText: null, remoteStatusError: false, remoteNameError: null, remoteHostError: null, remoteNameDraft: "", remoteHostDraft: "127.0.0.1:4732", remoteTokenDraft: "", nextRemoteNameSuggestion: "",
  tailscaleStatus: { installed: true, running: true, version: "1.2.3", tailnetName: "net.ts.net", suggestedRemoteHost: "box.net.ts.net:4732", message: "ok" }, tailscaleStatusBusy: false, tailscaleStatusError: null, tailscaleCommandPreview: null, tailscaleCommandBusy: false, tailscaleCommandError: null,
  tcpDaemonStatus: { state: "stopped", pid: null, startedAtMs: null, lastError: null, listenAddr: null }, tcpDaemonBusyAction: null,
  onSetRemoteNameDraft: vi.fn(), onSetRemoteHostDraft: vi.fn(), onSetRemoteTokenDraft: vi.fn(), onCommitRemoteName: vi.fn(), onCommitRemoteHost: vi.fn(), onCommitRemoteToken: vi.fn(), onSelectRemoteBackend: vi.fn(), onAddRemoteBackend: vi.fn(), onMoveRemoteBackend: vi.fn(), onDeleteRemoteBackend: vi.fn(),
  onRefreshTailscaleStatus: vi.fn(), onRefreshTailscaleCommandPreview: vi.fn(), onUseSuggestedTailscaleHost: vi.fn(), onTcpDaemonStart: vi.fn(), onTcpDaemonStop: vi.fn(), onTcpDaemonStatus: vi.fn(), onMobileConnectTest: vi.fn() }, ...extra }) as unknown as ComponentProps<typeof SettingsServerSection>)} />);

it("shows the access token and listening address in Local mode and gates Start on a saved token", () => {
  server({});
  expect(screen.getByText("Access token")).toBeTruthy();
  expect(screen.getByText("Listening port")).toBeTruthy();
  expect(screen.queryByText("Server address")).toBeNull();
  expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Start" }).title).toBe("Set an access token to start");
  expect(screen.getByText("box.net.ts.net:4732")).toBeTruthy();
  expect(screen.getAllByText(/Set an access token/).length).toBeGreaterThan(0);
});

it("shows the server address and token in Remote mode instead of the phone rows", () => {
  server({ backendMode: "remote", remoteBackendToken: "abc" });
  expect(screen.getByText("Server address")).toBeTruthy();
  expect(screen.getByText("Server token")).toBeTruthy();
  expect(screen.queryByText("Listening port")).toBeNull();
  expect(screen.getByText("Phone access uses the server token and port set above.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(false);
});

it("hides Browser binary under Native and summarises the site rules", () => {
  render(<SettingsBrowserSection appSettings={{ browser: { allowedOrigins: ["https://a.test", "https://b.test"], blockedOrigins: ["https://c.test"] } } as AppSettings} onUpdateAppSettings={vi.fn()} />);
  expect(screen.queryByLabelText("Browser binary")).toBeNull();
  expect(screen.getByRole("button", { name: /Site rules/ }).textContent).toContain("Allowlist: 2 sites · 1 blocked");
  fireEvent.change(screen.getByLabelText("Engine"), { target: { value: "cdp" } });
  expect(screen.getByLabelText("Browser binary")).toBeTruthy();
  cleanup();
  render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Site rules/ }).textContent).toContain("All sites allowed");
});

it("disables Reset all with a reason only when every shortcut is at its default", () => {
  const drafts = { newAgent: "cmd+n", newWorktreeAgent: "cmd+shift+n", newCloneAgent: "cmd+alt+n", archiveThread: "cmd+ctrl+a", model: "cmd+shift+m", access: "cmd+shift+a", reasoning: "cmd+shift+r", collaboration: "shift+tab" } as never;
  render(<SettingsShortcutsSection shortcutDrafts={drafts} onShortcutKeyDown={vi.fn()} onClearShortcut={vi.fn()} onSetShortcut={vi.fn()} />);
  const button = screen.getByRole("button", { name: "Reset all…" }) as HTMLButtonElement;
  expect(button.title === "Every shortcut is at its default" || !button.disabled).toBe(true);
});

it("expands a disclosure row with the chevron at the row inset", () => {
  render(<SettingsDisclosureRow label="Details" summary="More">Body text</SettingsDisclosureRow>);
  const head = screen.getByRole("button", { name: /Details/ });
  expect(head.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("Body text").hidden).toBe(true);
  fireEvent.click(head);
  expect(head.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Body text").hidden).toBe(false);
  expect(head.querySelector("svg")).toBeTruthy();
});
