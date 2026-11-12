import { useWindowDrag } from "@/features/layout/hooks/useWindowDrag";
import {
  REMOTE_WORKSPACE_REFRESH_INTERVAL_MS,
  useWorkspaceRefreshOnFocus,
} from "@/features/workspaces/hooks/useWorkspaceRefreshOnFocus";
import { useWorkspaceRestore } from "@/features/workspaces/hooks/useWorkspaceRestore";
import { useTabActivationGuard } from "@app/hooks/useTabActivationGuard";
import {
  useRemoteThreadRefreshOnFocus,
} from "@app/hooks/useRemoteThreadRefreshOnFocus";
import type { WorkspaceInfo } from "@/types";
import { useCallback, useMemo } from "react";

type UseMainAppWorkspaceLifecycleArgs = {
  activeTab: "home" | "projects" | "codex" | "git" | "log";
  isTablet: boolean;
  setActiveTab: (tab: "home" | "projects" | "codex" | "git" | "log") => void;
  workspaces: WorkspaceInfo[];
  hasLoaded: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  listThreadsForWorkspaces: (workspaces: WorkspaceInfo[]) => Promise<void>;
  refreshWorkspaces: () => Promise<void | WorkspaceInfo[]>;
  backendMode: "local" | "remote";
  activeWorkspace: WorkspaceInfo | null;
  activeThreadId: string | null;
  threadStatusById: Record<string, { isProcessing: boolean }>;
  remoteThreadConnectionState: "live" | "polling" | "disconnected";
  refreshThread: (workspaceId: string, threadId: string) => Promise<unknown>;
  /** When set, only this workspace is connected and listed at start and on focus (a thread window's own). */
  onlyWorkspaceId?: string | null;
};

export function useMainAppWorkspaceLifecycle({
  activeTab,
  isTablet,
  setActiveTab,
  workspaces,
  hasLoaded,
  connectWorkspace,
  listThreadsForWorkspaces,
  refreshWorkspaces,
  backendMode,
  activeWorkspace,
  activeThreadId,
  threadStatusById,
  remoteThreadConnectionState,
  refreshThread,
  onlyWorkspaceId = null,
}: UseMainAppWorkspaceLifecycleArgs) {
  const scopedWorkspaces = useMemo(
    () => (onlyWorkspaceId ? workspaces.filter((workspace) => workspace.id === onlyWorkspaceId) : workspaces),
    [onlyWorkspaceId, workspaces],
  );
  const scopedListThreads = useCallback(
    (targets: WorkspaceInfo[], options?: { preserveState?: boolean; maxPages?: number }) =>
      (listThreadsForWorkspaces as (targets: WorkspaceInfo[], options?: object) => Promise<void>)(
        onlyWorkspaceId ? targets.filter((workspace) => workspace.id === onlyWorkspaceId) : targets,
        options,
      ),
    [listThreadsForWorkspaces, onlyWorkspaceId],
  );
  const listThreads = onlyWorkspaceId ? scopedListThreads : listThreadsForWorkspaces;

  useTabActivationGuard({
    activeTab,
    isTablet,
    setActiveTab,
  });

  useWindowDrag("titlebar");

  useWorkspaceRestore({
    workspaces: scopedWorkspaces,
    hasLoaded,
    connectWorkspace,
    listThreadsForWorkspaces: listThreads,
  });

  useWorkspaceRefreshOnFocus({
    workspaces: scopedWorkspaces,
    refreshWorkspaces,
    listThreadsForWorkspaces: listThreads,
    backendMode,
    pollIntervalMs: REMOTE_WORKSPACE_REFRESH_INTERVAL_MS,
  });

  useRemoteThreadRefreshOnFocus({
    backendMode,
    activeWorkspace,
    activeThreadId,
    activeThreadIsProcessing: Boolean(
      activeThreadId && threadStatusById[activeThreadId]?.isProcessing,
    ),
    suspendPolling:
      backendMode === "remote" && remoteThreadConnectionState === "live",
    reconnectWorkspace: connectWorkspace,
    refreshThread,
  });
}
