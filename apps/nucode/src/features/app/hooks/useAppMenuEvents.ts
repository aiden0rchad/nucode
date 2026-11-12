import { useFeatures } from "@settings/features";
import { useThreadWindowEffects } from "../threadWindow";
import type { MutableRefObject } from "react";
import { useTauriEvent } from "./useTauriEvent";
import {
  subscribeMenuAddWorkspace,
  subscribeMenuAddWorkspaceFromUrl,
  subscribeMenuNewAgent,
  subscribeMenuNewCloneAgent,
  subscribeMenuNewWorktreeAgent,
  subscribeMenuOpenSettings,
  subscribeMenuOpenThreadWindow,
  subscribeMenuPrevAgent,
  subscribeMenuNextAgent,
  subscribeMenuPrevWorkspace,
  subscribeMenuNextWorkspace,
  subscribeMenuToggleDebugPanel,
  subscribeMenuToggleGitSidebar,
  subscribeMenuToggleProjectsSidebar,
  subscribeMenuToggleTerminal,
} from "../../../services/events";
import type { WorkspaceInfo } from "../../../types";

type Params = {
  activeWorkspaceRef: MutableRefObject<WorkspaceInfo | null>;
  baseWorkspaceRef: MutableRefObject<WorkspaceInfo | null>;
  onAddWorkspace: () => void;
  onAddWorkspaceFromUrl: () => void;
  onAddAgent: (workspace: WorkspaceInfo) => void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onOpenSettings: () => void;
  /** File > Open Thread in New Window: the open thread gets its own window. */
  onOpenThreadWindow?: () => void;
  onCycleAgent: (direction: "next" | "prev") => void;
  onCycleWorkspace: (direction: "next" | "prev") => void;
  onToggleDebug: () => void;
  onToggleTerminal: () => void;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  onExpandSidebar: () => void;
  onCollapseSidebar: () => void;
  onExpandRightPanel: () => void;
  onCollapseRightPanel: () => void;
};

export function useAppMenuEvents({
  activeWorkspaceRef,
  baseWorkspaceRef,
  onAddWorkspace,
  onAddWorkspaceFromUrl,
  onAddAgent,
  onAddWorktreeAgent,
  onAddCloneAgent,
  onOpenSettings,
  onOpenThreadWindow,
  onCycleAgent,
  onCycleWorkspace,
  onToggleDebug,
  onToggleTerminal,
  sidebarCollapsed,
  rightPanelCollapsed,
  onExpandSidebar,
  onCollapseSidebar,
  onExpandRightPanel,
  onCollapseRightPanel,
}: Params) {
  const features = useFeatures();
  const { menuAndShortcutListeners: enabled } = useThreadWindowEffects();
  useTauriEvent(subscribeMenuNewAgent, () => {
    const workspace = activeWorkspaceRef.current;
    if (workspace) {
      onAddAgent(workspace);
    }
  }, { enabled });

  useTauriEvent(subscribeMenuNewWorktreeAgent, () => {
    if (!features.worktrees) return;
    const workspace = baseWorkspaceRef.current;
    if (workspace) {
      onAddWorktreeAgent(workspace);
    }
  }, { enabled });

  useTauriEvent(subscribeMenuNewCloneAgent, () => {
    if (!features.worktrees) return;
    const workspace = baseWorkspaceRef.current;
    if (workspace) {
      onAddCloneAgent(workspace);
    }
  }, { enabled });

  useTauriEvent(subscribeMenuAddWorkspace, () => {
    onAddWorkspace();
  }, { enabled });

  useTauriEvent(subscribeMenuAddWorkspaceFromUrl, () => {
    onAddWorkspaceFromUrl();
  }, { enabled });

  useTauriEvent(subscribeMenuOpenSettings, () => {
    onOpenSettings();
  }, { enabled });

  useTauriEvent(subscribeMenuOpenThreadWindow, () => {
    onOpenThreadWindow?.();
  }, { enabled });

  useTauriEvent(subscribeMenuNextAgent, () => {
    onCycleAgent("next");
  }, { enabled });

  useTauriEvent(subscribeMenuPrevAgent, () => {
    onCycleAgent("prev");
  }, { enabled });

  useTauriEvent(subscribeMenuNextWorkspace, () => {
    onCycleWorkspace("next");
  }, { enabled });

  useTauriEvent(subscribeMenuPrevWorkspace, () => {
    onCycleWorkspace("prev");
  }, { enabled });

  useTauriEvent(subscribeMenuToggleDebugPanel, () => {
    onToggleDebug();
  }, { enabled });

  useTauriEvent(subscribeMenuToggleTerminal, () => {
    if (features.terminal) onToggleTerminal();
  }, { enabled });

  useTauriEvent(subscribeMenuToggleProjectsSidebar, () => {
    if (sidebarCollapsed) {
      onExpandSidebar();
    } else {
      onCollapseSidebar();
    }
  }, { enabled });

  useTauriEvent(subscribeMenuToggleGitSidebar, () => {
    if (!features.git) return;
    if (rightPanelCollapsed) {
      onExpandRightPanel();
    } else {
      onCollapseRightPanel();
    }
  }, { enabled });
}