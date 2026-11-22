// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import type { ConversationItem } from "../../../types";
import { useNewAgentDraft, withPendingFirstMessage } from "./useNewAgentDraft";

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Workspace",
  path: "/tmp/ws-1",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useNewAgentDraft", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears starting state after successful send when no thread activates", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useNewAgentDraft({
        activeWorkspace: workspace,
        activeWorkspaceId: workspace.id,
        activeThreadId: null,
      }),
    );

    await act(async () => {
      await result.current.runWithDraftStart(async () => {
        await Promise.resolve();
      });
    });

    expect(result.current.startingDraftThreadWorkspaceId).toBe(workspace.id);

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(result.current.startingDraftThreadWorkspaceId).toBeNull();
  });

  it("serializes draft-start sends and does not drop concurrent submits", async () => {
    let resolveRunner!: () => void;
    let callCount = 0;
    const runner = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<void>((resolve) => {
          resolveRunner = () => resolve();
        });
      }
      return Promise.resolve();
    });

    const { result } = renderHook(() =>
      useNewAgentDraft({
        activeWorkspace: workspace,
        activeWorkspaceId: workspace.id,
        activeThreadId: null,
      }),
    );

    let firstPromise: Promise<void> | null = null;
    let secondPromise: Promise<void> | null = null;
    act(() => {
      firstPromise = result.current.runWithDraftStart(runner);
      secondPromise = result.current.runWithDraftStart(runner);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(runner).toHaveBeenCalledTimes(1);
    if (!firstPromise || !secondPromise) {
      throw new Error("Expected concurrent draft-start promises to be initialized.");
    }
    resolveRunner();
    await act(async () => {
      await firstPromise;
      await secondPromise;
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("shows the first message while the thread start is pending and once after the real item arrives", async () => {
    let finishStart!: () => void;
    const { result } = renderHook(() =>
      useNewAgentDraft({
        activeWorkspace: workspace,
        activeWorkspaceId: workspace.id,
        activeThreadId: null,
      }),
    );
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.runWithDraftStart(
        () => new Promise<void>((resolve) => { finishStart = resolve; }),
        { text: "Build it", images: [] },
      );
    });
    await act(async () => { await Promise.resolve(); });

    const pending = result.current.pendingFirstMessage;
    const shown = withPendingFirstMessage([], pending, workspace.id);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ kind: "message", role: "user", text: "Build it" });

    const real: ConversationItem[] = [
      { id: "optimistic-user-1", kind: "message", role: "user", text: "Build it" },
    ];
    expect(withPendingFirstMessage(real, pending, workspace.id)).toBe(real);
    expect(withPendingFirstMessage([], pending, "ws-other")).toEqual([]);

    await act(async () => { finishStart(); await sending; });
    expect(result.current.pendingFirstMessage).toBeNull();
  });

  it("drops the pending message when the start fails", async () => {
    const { result } = renderHook(() =>
      useNewAgentDraft({
        activeWorkspace: workspace,
        activeWorkspaceId: workspace.id,
        activeThreadId: null,
      }),
    );
    await act(async () => {
      await result.current
        .runWithDraftStart(() => Promise.reject(new Error("boom")), { text: "Hi", images: [] })
        .catch(() => undefined);
    });
    expect(result.current.pendingFirstMessage).toBeNull();
  });
});
