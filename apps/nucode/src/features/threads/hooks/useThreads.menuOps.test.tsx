// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "@/types";
import type { useAppServerEvents } from "@app/hooks/useAppServerEvents";
import {
  archiveThread,
  closeThreadWindow,
  deleteThread,
  listThreadHistory,
  moveThread,
  readThread,
  resumeThread,
  retargetThreadWindow,
} from "@services/tauri";
import { makeCustomNameKey, makePinKey, STORAGE_KEY_CUSTOM_NAMES, STORAGE_KEY_PINNED_THREADS } from "@threads/utils/threadStorage";
import { useThreads } from "./useThreads";

type AppServerHandlers = Parameters<typeof useAppServerEvents>[0];
let handlers: AppServerHandlers | null = null;
const pushErrorToast = vi.hoisted(() => vi.fn());

vi.mock("@app/hooks/useAppServerEvents", () => ({
  useAppServerEvents: (incoming: AppServerHandlers) => {
    handlers = incoming;
  },
}));
vi.mock("@services/toasts", () => ({ pushErrorToast: (...args: unknown[]) => pushErrorToast(...args) }));
vi.mock("@services/tauri", () => ({
  respondToServerRequest: vi.fn(),
  respondToUserInputRequest: vi.fn(),
  rememberApprovalRule: vi.fn(),
  sendUserMessage: vi.fn(),
  steerTurn: vi.fn(),
  startReview: vi.fn(),
  startThread: vi.fn(),
  listThreads: vi.fn(),
  resumeThread: vi.fn(),
  readThread: vi.fn(),
  listThreadHistory: vi.fn(),
  archiveThread: vi.fn(),
  deleteThread: vi.fn(),
  moveThread: vi.fn(),
  closeThreadWindow: vi.fn(() => Promise.resolve()),
  retargetThreadWindow: vi.fn(() => Promise.resolve()),
  setThreadName: vi.fn(),
  getAccountInfo: vi.fn(),
  interruptTurn: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "One",
  path: "/tmp/one",
  connected: true,
  settings: { sidebarCollapsed: false },
};

function setup() {
  const hook = renderHook(() => useThreads({ activeWorkspace: workspace, onWorkspaceConnected: vi.fn() }));
  act(() => {
    handlers?.onThreadStarted?.("ws-1", { id: "t1", preview: "First" });
    handlers?.onThreadStarted?.("ws-1", { id: "t2", preview: "Second" });
  });
  return hook;
}
const ids = (hook: ReturnType<typeof setup>, workspaceId = "ws-1") =>
  (hook.result.current.threadsByWorkspace[workspaceId] ?? []).map((thread) => thread.id);

beforeEach(() => {
  handlers = null;
  localStorage.clear();
  vi.clearAllMocks();
});

describe("archiving", () => {
  it("drops the row and the pin once the backend archives the thread", async () => {
    vi.mocked(archiveThread).mockResolvedValue({});
    const hook = setup();
    act(() => {
      hook.result.current.pinThread("ws-1", "t2");
    });
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.removeThread("ws-1", "t2");
    });
    expect(ok).toBe(true);
    expect(ids(hook)).toEqual(["t1"]);
    expect(hook.result.current.isThreadPinned("ws-1", "t2")).toBe(false);
    expect(pushErrorToast).not.toHaveBeenCalled();
    expect(closeThreadWindow).toHaveBeenCalledWith("t2");
  });

  it("restores the row where it was, and its pin, when the backend refuses", async () => {
    vi.mocked(archiveThread).mockRejectedValue(new Error("disk is read-only"));
    const hook = setup();
    const before = ids(hook);
    act(() => {
      hook.result.current.pinThread("ws-1", "t1");
    });
    let ok = true;
    await act(async () => {
      ok = await hook.result.current.removeThread("ws-1", "t1");
    });
    expect(ok).toBe(false);
    expect(ids(hook)).toEqual(before);
    expect(hook.result.current.isThreadPinned("ws-1", "t1")).toBe(true);
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't archive chat", message: "disk is read-only" }),
    );
    expect(closeThreadWindow).not.toHaveBeenCalled();
  });
});

describe("permanent delete", () => {
  it("removes the thread and its pin after the backend deletes it", async () => {
    vi.mocked(deleteThread).mockResolvedValue({});
    const hook = setup();
    act(() => {
      hook.result.current.pinThread("ws-1", "t1");
    });
    await act(async () => {
      expect(await hook.result.current.deleteThreadPermanently("ws-1", "t1")).toBe(true);
    });
    expect(deleteThread).toHaveBeenCalledWith("ws-1", "t1");
    expect(ids(hook)).toEqual(["t2"]);
    expect(localStorage.getItem(STORAGE_KEY_PINNED_THREADS)).not.toContain("t1");
    expect(closeThreadWindow).toHaveBeenCalledWith("t1");
  });

  it("keeps the thread and says why when the delete fails", async () => {
    vi.mocked(deleteThread).mockRejectedValue(new Error("Not available for Codex threads"));
    const hook = setup();
    await act(async () => {
      expect(await hook.result.current.deleteThreadPermanently("ws-1", "t1")).toBe(false);
    });
    expect(ids(hook).sort()).toEqual(["t1", "t2"]);
    expect(pushErrorToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't delete chat" }));
    expect(closeThreadWindow).not.toHaveBeenCalled();
  });
});

describe("moving to another project", () => {
  it("moves the row, the pin and the custom name to the new workspace id", async () => {
    vi.mocked(moveThread).mockResolvedValue({ result: { thread: { id: "t1", preview: "First", updatedAt: 5 } } });
    const hook = setup();
    localStorage.setItem(STORAGE_KEY_CUSTOM_NAMES, JSON.stringify({ [makeCustomNameKey("ws-1", "t1")]: "Mine" }));
    act(() => {
      hook.result.current.pinThread("ws-1", "t1");
    });
    await act(async () => {
      expect(await hook.result.current.moveThread("ws-1", "t1", "ws-2")).toBe(true);
    });
    expect(moveThread).toHaveBeenCalledWith("ws-1", "t1", "ws-2");
    expect(ids(hook)).toEqual(["t2"]);
    expect(ids(hook, "ws-2")).toEqual(["t1"]);
    expect(hook.result.current.isThreadPinned("ws-2", "t1")).toBe(true);
    expect(hook.result.current.isThreadPinned("ws-1", "t1")).toBe(false);
    const pins = JSON.parse(localStorage.getItem(STORAGE_KEY_PINNED_THREADS) ?? "{}");
    expect(Object.keys(pins)).toEqual([makePinKey("ws-2", "t1")]);
    expect(retargetThreadWindow).toHaveBeenCalledWith("t1", "ws-2");
  });

  it("leaves everything in place and reports the error when the move fails", async () => {
    vi.mocked(moveThread).mockRejectedValue(new Error("Finish or interrupt the turn first"));
    const hook = setup();
    act(() => {
      hook.result.current.pinThread("ws-1", "t1");
    });
    await act(async () => {
      expect(await hook.result.current.moveThread("ws-1", "t1", "ws-2")).toBe(false);
    });
    expect(ids(hook).sort()).toEqual(["t1", "t2"]);
    expect(ids(hook, "ws-2")).toEqual([]);
    expect(hook.result.current.isThreadPinned("ws-1", "t1")).toBe(true);
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't move chat", message: "Finish or interrupt the turn first" }),
    );
    expect(retargetThreadWindow).not.toHaveBeenCalled();
  });

  it("hands a failure to a caller that wants to word it itself", async () => {
    vi.mocked(moveThread).mockRejectedValue(new Error("nope"));
    const hook = setup();
    const report = vi.fn();
    await act(async () => {
      await hook.result.current.moveThread("ws-1", "t1", "ws-2", report);
    });
    expect(report).toHaveBeenCalledWith("nope");
    expect(pushErrorToast).not.toHaveBeenCalled();
  });
});

describe("reading a thread for export", () => {
  it("reads and pages it without resuming or changing state", async () => {
    vi.mocked(readThread).mockResolvedValue({
      result: { thread: { id: "t1", historyCursor: "c1", turns: [{ id: "b", status: "completed", items: [{ type: "userMessage", id: "u2", content: [{ type: "text", text: "two", text_elements: [] }] }] }] } },
    });
    vi.mocked(listThreadHistory).mockResolvedValue({
      data: [{ id: "a", status: "completed", items: [{ type: "userMessage", id: "u1", content: [{ type: "text", text: "one", text_elements: [] }] }] }],
      nextCursor: null,
    } as never);
    const hook = setup();
    const before = hook.result.current.itemsByThread;
    let items: Array<{ kind: string; text?: string }> = [];
    await act(async () => {
      items = await hook.result.current.loadThreadItems("ws-1", "t1");
    });
    expect(items.filter((item) => item.kind === "message").map((item) => item.text)).toEqual(["one", "two"]);
    expect(resumeThread).not.toHaveBeenCalled();
    expect(hook.result.current.itemsByThread).toBe(before);
  });
});
