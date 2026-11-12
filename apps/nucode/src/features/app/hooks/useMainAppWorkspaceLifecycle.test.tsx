// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "@/types";
import { useMainAppWorkspaceLifecycle } from "./useMainAppWorkspaceLifecycle";

const restore = vi.hoisted(() => vi.fn());
const refreshOnFocus = vi.hoisted(() => vi.fn());

vi.mock("@/features/layout/hooks/useWindowDrag", () => ({ useWindowDrag: vi.fn() }));
vi.mock("@/features/workspaces/hooks/useWorkspaceRestore", () => ({ useWorkspaceRestore: (args: unknown) => restore(args) }));
vi.mock("@/features/workspaces/hooks/useWorkspaceRefreshOnFocus", () => ({
  REMOTE_WORKSPACE_REFRESH_INTERVAL_MS: 15000,
  useWorkspaceRefreshOnFocus: (args: unknown) => refreshOnFocus(args),
}));
vi.mock("@app/hooks/useTabActivationGuard", () => ({ useTabActivationGuard: vi.fn() }));
vi.mock("@app/hooks/useRemoteThreadRefreshOnFocus", () => ({ useRemoteThreadRefreshOnFocus: vi.fn() }));

const workspace = (id: string) => ({ id, name: id, path: `/tmp/${id}`, connected: true, settings: {} }) as WorkspaceInfo;
const workspaces = [workspace("w1"), workspace("w2"), workspace("w3")];

function mount(onlyWorkspaceId?: string | null) {
  const listThreadsForWorkspaces = vi.fn(async () => {});
  renderHook(() =>
    useMainAppWorkspaceLifecycle({
      activeTab: "codex",
      isTablet: false,
      setActiveTab: vi.fn(),
      workspaces,
      hasLoaded: true,
      connectWorkspace: vi.fn(async () => {}),
      listThreadsForWorkspaces,
      refreshWorkspaces: vi.fn(async () => {}),
      backendMode: "local",
      activeWorkspace: null,
      activeThreadId: null,
      threadStatusById: {},
      remoteThreadConnectionState: "live",
      refreshThread: vi.fn(async () => {}),
      onlyWorkspaceId,
    }),
  );
  return { listThreadsForWorkspaces };
}

beforeEach(() => vi.clearAllMocks());

describe("useMainAppWorkspaceLifecycle", () => {
  it("restores and refreshes every workspace by default", () => {
    const { listThreadsForWorkspaces } = mount();
    expect(restore.mock.calls[0][0].workspaces).toEqual(workspaces);
    expect(restore.mock.calls[0][0].listThreadsForWorkspaces).toBe(listThreadsForWorkspaces);
    expect(refreshOnFocus.mock.calls[0][0].workspaces).toEqual(workspaces);
  });

  it("restores and lists only the given workspace for a thread window", async () => {
    const { listThreadsForWorkspaces } = mount("w2");
    expect(restore.mock.calls[0][0].workspaces.map((entry: WorkspaceInfo) => entry.id)).toEqual(["w2"]);
    expect(refreshOnFocus.mock.calls[0][0].workspaces.map((entry: WorkspaceInfo) => entry.id)).toEqual(["w2"]);
    await restore.mock.calls[0][0].listThreadsForWorkspaces(workspaces, { maxPages: 6 });
    expect(listThreadsForWorkspaces).toHaveBeenCalledWith([workspaces[1]], { maxPages: 6 });
  });
});
