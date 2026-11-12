// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  THREAD_WINDOW_EFFECTS,
  ThreadWindowContext,
  freezeSharedStorage,
  readThreadWindowTarget,
  threadWindowEffects,
  useThreadWindow,
  useThreadWindowEffects,
} from "./threadWindow";

describe("readThreadWindowTarget", () => {
  it("reads the target the backend set, synchronously", () => {
    expect(readThreadWindowTarget({ __NUCODE_THREAD_WINDOW__: { workspaceId: "w1", threadId: "t1" } })).toEqual({
      workspaceId: "w1",
      threadId: "t1",
    });
  });

  it("is null for the main window and for anything that is not two ids", () => {
    expect(readThreadWindowTarget({})).toBeNull();
    expect(readThreadWindowTarget(undefined)).toBeNull();
    for (const value of [null, "t1", 3, {}, { workspaceId: "w1" }, { threadId: "t1" }, { workspaceId: "", threadId: "t1" }, { workspaceId: "w1", threadId: 4 }]) {
      expect(readThreadWindowTarget({ __NUCODE_THREAD_WINDOW__: value })).toBeNull();
    }
  });

  it("is not a thread window in the test environment, as in the main window", () => {
    expect(readThreadWindowTarget()).toBeNull();
  });
});

describe("thread window effects", () => {
  const stayOn = ["composerCycles", "stop"];
  const off = [
    "titleAutogeneration",
    "trayRecentThreads",
    "sounds",
    "systemNotifications",
    "updater",
    "dictation",
    "menuAndShortcutListeners",
    "threadShortcuts",
    "mobileServerSetup",
    "workspaceRestore",
    "automaticApprovals",
    "sharedStorageWrites",
  ];

  it("lists every guarded effect in one place", () => {
    expect(Object.keys(THREAD_WINDOW_EFFECTS).sort()).toEqual([...off, ...stayOn].sort());
  });

  it("runs everything in the main window", () => {
    expect(Object.values(threadWindowEffects(null)).every(Boolean)).toBe(true);
  });

  it("runs only the composer cycles and Stop in a thread window", () => {
    const effects = threadWindowEffects({ workspaceId: "w1", threadId: "t1" });
    for (const name of stayOn) expect(effects[name as keyof typeof effects]).toBe(true);
    for (const name of off) expect(effects[name as keyof typeof effects]).toBe(false);
  });

  it("follows the window context", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThreadWindowContext.Provider value={{ workspaceId: "w1", threadId: "t1" }}>{children}</ThreadWindowContext.Provider>
    );
    const inThread = renderHook(() => [useThreadWindow(), useThreadWindowEffects()] as const, { wrapper });
    expect(inThread.result.current[0]).toEqual({ workspaceId: "w1", threadId: "t1" });
    expect(inThread.result.current[1].updater).toBe(false);
    const inMain = renderHook(() => [useThreadWindow(), useThreadWindowEffects()] as const);
    expect(inMain.result.current[0]).toBeNull();
    expect(inMain.result.current[1].updater).toBe(true);
  });
});

describe("freezeSharedStorage", () => {
  it("keeps what main wrote readable and refuses writes, until undone", () => {
    localStorage.setItem("shared", "main");
    const undo = freezeSharedStorage();
    localStorage.setItem("shared", "thread");
    localStorage.setItem("other", "x");
    localStorage.removeItem("shared");
    localStorage.clear();
    expect(localStorage.getItem("shared")).toBe("main");
    expect(localStorage.getItem("other")).toBeNull();
    sessionStorage.setItem("mine", "1");
    expect(sessionStorage.getItem("mine")).toBe("1");
    undo();
    localStorage.setItem("shared", "again");
    expect(localStorage.getItem("shared")).toBe("again");
    localStorage.clear();
    sessionStorage.clear();
  });
});
