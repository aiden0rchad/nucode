// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { installUiPreview } from "@/dev/uiPreview";
import { freezeSharedStorage } from "@app/threadWindow";

// The backend sets this before any page script runs; it has to be there before the app's modules load.
vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__NUCODE_THREAD_WINDOW__ = { workspaceId: "workspace-atlas", threadId: "thread-rich" };
});

// jsdom has no Web Workers; render diffs on the main thread in these UI tests.
vi.mock("@pierre/diffs/react", async () => ({
  ...(await vi.importActual<typeof import("@pierre/diffs/react")>("@pierre/diffs/react")),
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => children,
}));

const { default: App } = await import("@/App");

let unfreeze = () => {};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("innerWidth", 1440);
  unfreeze = freezeSharedStorage();
});
afterEach(async () => {
  unfreeze();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  clearMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens its thread and renders the transcript and composer only", async () => {
  installUiPreview("?mode=code");
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => unknown } }).__TAURI_INTERNALS__;
  const invoke = internals.invoke;
  const commands: string[] = [];
  internals.invoke = (command, ...rest) => { commands.push(command); return invoke(command, ...rest); };

  render(<App />);
  await waitFor(() => expect(screen.getAllByText(/Update the greeting, run the tests/).length).toBeGreaterThan(0), { timeout: 15000 });

  expect(document.querySelector(".thread-window-title")?.textContent).toBe("Polish the welcome message");
  expect(screen.getByRole("textbox")).toBeTruthy();
  // No sidebar, mode switch, session rail, side panel, terminal or home.
  expect(screen.queryByRole("navigation", { name: "App mode" })).toBeNull();
  for (const selector of [".sidebar", ".workspace-shell", ".dock-pane", ".workspace-titlebar", ".terminal-panel", ".home"]) {
    expect(document.querySelector(selector), selector).toBeNull();
  }
  // None of the main window's effects ran: no tray sync, no accelerator updates, no shared storage writes.
  expect(commands).not.toContain("set_tray_recent_threads");
  expect(commands).not.toContain("menu_set_accelerators");
  expect(localStorage.length).toBe(0);
}, 30000);
