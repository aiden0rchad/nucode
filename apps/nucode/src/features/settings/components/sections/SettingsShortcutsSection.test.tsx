// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsShortcutsSection } from "./SettingsShortcutsSection";
import type { ShortcutDrafts } from "@settings/components/settingsTypes";

afterEach(cleanup);
const drafts = (patch: Partial<ShortcutDrafts>) => ({ newAgent: "cmd+n", newWorktreeAgent: "cmd+shift+n", newCloneAgent: "cmd+alt+n", archiveThread: "cmd+ctrl+a", model: "cmd+shift+m", access: "cmd+shift+a", reasoning: "cmd+shift+r", collaboration: "shift+tab", interrupt: "", projectsSidebar: "", gitSidebar: "", branchSwitcher: "", debugPanel: "", terminal: "", cycleAgentNext: "", cycleAgentPrev: "", cycleWorkspaceNext: "", cycleWorkspacePrev: "", ...patch }) as ShortcutDrafts;

it("shows a reset button only for a changed shortcut and a clear button only for a set one", () => {
  const set = vi.fn(), clear = vi.fn();
  render(<SettingsShortcutsSection shortcutDrafts={drafts({ newAgent: "cmd+j", terminal: "" })} onShortcutKeyDown={vi.fn()} onClearShortcut={clear} onSetShortcut={set} />);
  expect(screen.queryByRole("button", { name: "Reset New Worktree Agent" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reset New Agent" }));
  expect(set).toHaveBeenCalledWith("newAgentShortcut", "cmd+n");
  expect(screen.getByRole("button", { name: "Reset Toggle terminal panel" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Clear Toggle terminal panel" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear New Agent" }));
  expect(clear).toHaveBeenCalledWith("newAgentShortcut");
  expect(screen.queryByText(/Default:/)).toBeNull();
});

it("shows Press keys while recording and Not set for an empty shortcut", () => {
  render(<SettingsShortcutsSection shortcutDrafts={drafts({ terminal: "" })} onShortcutKeyDown={vi.fn()} onClearShortcut={vi.fn()} />);
  expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
  fireEvent.focus(screen.getByRole("textbox", { name: "New Agent" }));
  expect(screen.getByText("Press keys…")).toBeTruthy();
});

it("lists the thread shortcuts in their own group and resets one to its default", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const set = vi.fn();
  render(<SettingsShortcutsSection shortcutDrafts={drafts({ renameThread: "cmd+j", pinThread: "cmd+alt+p", markThreadUnread: "cmd+shift+u" })} onShortcutKeyDown={vi.fn()} onClearShortcut={vi.fn()} onSetShortcut={set} />);
  expect(screen.getByText("Threads")).toBeTruthy();
  for (const name of ["Rename thread", "Pin or unpin thread", "Mark thread as unread", "Archive thread"]) {
    expect(screen.getByRole("textbox", { name })).toBeTruthy();
  }
  expect(screen.queryByRole("button", { name: "Reset Pin or unpin thread" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reset Rename thread" }));
  expect(set).toHaveBeenCalledWith("renameThreadShortcut", "cmd+alt+r");
});

it("resets every changed shortcut after confirmation", () => {
  const set = vi.fn();
  render(<SettingsShortcutsSection shortcutDrafts={drafts({ newAgent: "cmd+j", model: "cmd+k" })} onShortcutKeyDown={vi.fn()} onClearShortcut={vi.fn()} onSetShortcut={set} />);
  fireEvent.click(screen.getByRole("button", { name: "Reset all…" }));
  expect(set).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
  expect(set).toHaveBeenCalledWith("newAgentShortcut", "cmd+n");
  expect(set).toHaveBeenCalledWith("composerModelShortcut", "cmd+shift+m");
});
