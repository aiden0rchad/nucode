import { useThreadOrder } from "../hooks/useThreadOrder";
import type { DropPosition } from "../hooks/useSidebarReorder";
import { SidebarProjects } from "./SidebarTree";
import type {
  ConversationItem,
  RequestUserInputRequest,
  ThreadListOrganizeMode,
  ThreadListSortKey,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { FolderOpen } from "lucide-react";
import { SidebarBottomRail } from "./SidebarBottomRail";
import { SidebarActivity } from "./SidebarActivity";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarSearchBar } from "./SidebarSearchBar";
import { SidebarThreadsOnlySection } from "./SidebarThreadsOnlySection";
import { SidebarWorkspaceGroups } from "./SidebarWorkspaceGroups";
import { PinnedThreadList } from "./PinnedThreadList";
import {
  countRootRows,
  splitRowsByRoot,
  threadMatchesQuery,
  workspaceMatchesQuery,
} from "./threadSearchUtils";
import type {
  FlatThreadRootGroup,
  FlatThreadRow,
  SidebarOverlayMenuAnchor,
  SidebarWorkspaceAddMenuAnchor,
  ThreadBucket,
  WorkspaceGroupSection,
} from "./sidebarTypes";
import { useCollapsedGroups } from "../hooks/useCollapsedGroups";
import { useMenuController } from "../hooks/useMenuController";
import { useSidebarMenus } from "../hooks/useSidebarMenus";
import { useProjectPins } from "../hooks/useProjectPins";
import { useThreadSections } from "../hooks/useThreadSections";
import { useSidebarScrollFade } from "../hooks/useSidebarScrollFade";
import { useThreadRows } from "../hooks/useThreadRows";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { formatRelativeTimeShort } from "../../../utils/time";
import type { ThreadStatusById } from "../../../utils/threadStatus";

const COLLAPSED_GROUPS_STORAGE_KEY = "codexmonitor.collapsedGroups";
const UNGROUPED_COLLAPSE_ID = "__ungrouped__";
const ADD_MENU_WIDTH = 200;
const ALL_THREADS_ADD_MENU_WIDTH = 220;
const NO_SECTIONS: Array<{ id: string; name: string }> = [];

function getThreadBucketId(timestamp: number, nowMs: number): ThreadBucket["id"] {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

  if (timestamp >= nowMs - 60 * 60 * 1000) {
    return "now";
  }
  if (timestamp >= startOfToday) {
    return "today";
  }
  if (timestamp >= startOfYesterday) {
    return "yesterday";
  }
  if (timestamp >= startOfWeek) {
    return "week";
  }
  return "older";
}

function groupFlatThreadRowsByTimeBucket(
  groups: FlatThreadRootGroup[],
  nowMs: number,
): ThreadBucket[] {
  const bucketLabels: Record<ThreadBucket["id"], string> = {
    now: "Now",
    today: "Earlier today",
    yesterday: "Yesterday",
    week: "This week",
    older: "Older",
  };
  const order: ThreadBucket["id"][] = ["now", "today", "yesterday", "week", "older"];
  const bucketMap = new Map<ThreadBucket["id"], FlatThreadRow[]>();

  groups.forEach((group) => {
    const bucketId = getThreadBucketId(group.rootTimestamp, nowMs);
    const list = bucketMap.get(bucketId) ?? [];
    list.push(...group.rows);
    bucketMap.set(bucketId, list);
  });

  return order
    .filter((bucketId) => (bucketMap.get(bucketId) ?? []).length > 0)
    .map((bucketId) => ({
      id: bucketId,
      label: bucketLabels[bucketId],
      rows: bucketMap.get(bucketId) ?? [],
    }));
}

type SidebarProps = {
  newThreadShortcut?: string | null;
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  newAgentDraftWorkspaceId?: string | null;
  startingDraftThreadWorkspaceId?: string | null;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadParentById: Record<string, string>;
  threadStatusById: ThreadStatusById;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  pinnedThreadsVersion: number;
  threadListSortKey: ThreadListSortKey;
  onSetThreadListSortKey: (sortKey: ThreadListSortKey) => void;
  threadListOrganizeMode: ThreadListOrganizeMode;
  onSetThreadListOrganizeMode: (organizeMode: ThreadListOrganizeMode) => void;
  onRefreshAllThreads: () => void;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  userInputRequests?: RequestUserInputRequest[];
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  onAddWorkspace: () => void;
  onSelectHome: () => void;
  onReorderWorkspace?: (id: string, targetId: string, position: DropPosition) => void;
  onMoveWorkspace?: (id: string, direction: "up" | "down") => void;
  onSelectWorkspace: (id: string) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onAddAgent: (workspace: WorkspaceInfo) => void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  pinThread: (workspaceId: string, threadId: string) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  /** Sections (workspace groups) a project or chat can be filed under, in display order. */
  workspaceSections?: Array<{ id: string; name: string }>;
  onCreateSection?: (name: string) => Promise<string | null>;
  onAssignWorkspaceSection?: (workspaceId: string, sectionId: string | null) => void;
  onEditProject?: (workspaceId: string) => void;
  onSetThreadUnread?: (workspaceId: string, threadId: string, unread: boolean) => void;
  onForkThread?: (workspaceId: string, threadId: string) => void;
  loadThreadItems?: (workspaceId: string, threadId: string) => Promise<ConversationItem[]>;
  workspaceDropTargetRef: RefObject<HTMLElement | null>;
  isWorkspaceDropActive: boolean;
  workspaceDropText: string;
  onWorkspaceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDrop: (event: React.DragEvent<HTMLElement>) => void;
};

export const Sidebar = memo(function Sidebar({
  newThreadShortcut,
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups,
  deletingWorktreeIds,
  newAgentDraftWorkspaceId = null,
  startingDraftThreadWorkspaceId = null,
  threadsByWorkspace,
  threadParentById,
  threadStatusById,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  pinnedThreadsVersion,
  threadListSortKey,
  onSetThreadListSortKey,
  threadListOrganizeMode,
  onSetThreadListOrganizeMode,
  onRefreshAllThreads,
  activeWorkspaceId,
  activeThreadId,
  userInputRequests = [],
  onOpenSettings,
  onOpenDebug,
  showDebugButton,
  onAddWorkspace,
  onSelectHome,
  onReorderWorkspace,
  onMoveWorkspace,
  onSelectWorkspace,
  onConnectWorkspace,
  onAddAgent,
  onAddWorktreeAgent,
  onAddCloneAgent,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onDeleteThread,
  onSyncThread,
  pinThread,
  unpinThread,
  isThreadPinned,
  getPinTimestamp,
  getThreadArgsBadge,
  onRenameThread,
  onDeleteWorkspace,
  onDeleteWorktree,
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
  workspaceSections = NO_SECTIONS,
  onCreateSection,
  onAssignWorkspaceSection,
  onEditProject,
  onSetThreadUnread,
  onForkThread,
  loadThreadItems,
  workspaceDropTargetRef,
  isWorkspaceDropActive,
  workspaceDropText,
  onWorkspaceDragOver,
  onWorkspaceDragEnter,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
}: SidebarProps) {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(
    new Set<string>(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] =
    useState<SidebarWorkspaceAddMenuAnchor | null>(null);
  const [allThreadsAddMenuAnchor, setAllThreadsAddMenuAnchor] =
    useState<SidebarOverlayMenuAnchor | null>(null);
  const allThreadsAddMenuOpen = Boolean(allThreadsAddMenuAnchor);
  const addMenuController = useMenuController({
    open: Boolean(addMenuAnchor),
    onDismiss: () => setAddMenuAnchor(null),
  });
  const { containerRef: addMenuRef } = addMenuController;
  const allThreadsAddMenuController = useMenuController({
    open: Boolean(allThreadsAddMenuAnchor),
    onDismiss: () => setAllThreadsAddMenuAnchor(null),
  });
  const { containerRef: allThreadsAddMenuRef } = allThreadsAddMenuController;
  const { collapsedGroups, toggleGroupCollapse } = useCollapsedGroups(
    COLLAPSED_GROUPS_STORAGE_KEY,
  );
  const { getOrder, saveOrder, version: orderVersion } = useThreadOrder();
  const { getThreadRows } = useThreadRows(
    threadParentById, threadListOrganizeMode === "threads_only" ? undefined : getOrder, orderVersion,
  );
  const rootOrder = (workspaceId: string) => {
    const rows = getThreadRows(threadsByWorkspace[workspaceId] ?? [], true, workspaceId, getPinTimestamp, pinnedThreadsVersion);
    return rows.unpinnedRows.filter(row => row.depth === 0).map(row => row.thread.id);
  };
  const reorderThread = (workspaceId: string, id: string, targetId: string, position: DropPosition) => {
    const order = rootOrder(workspaceId);
    if (!order.includes(id) || !order.includes(targetId) || id === targetId) return;
    order.splice(order.indexOf(id), 1);
    order.splice(order.indexOf(targetId) + (position === "after" ? 1 : 0), 0, id);
    saveOrder(workspaceId, order);
  };
  const moveThread = (workspaceId: string, id: string, direction: "up" | "down") => {
    const order = rootOrder(workspaceId);
    if (!order.includes(id)) return;
    const target = order[order.indexOf(id) + (direction === "up" ? -1 : 1)];
    if (target) reorderThread(workspaceId, id, target, direction === "up" ? "before" : "after");
  };
  const togglePin = (workspaceId: string, threadId: string) => {
    if (isThreadPinned(workspaceId, threadId)) {
      unpinThread(workspaceId, threadId);
    } else {
      pinThread(workspaceId, threadId);
    }
  };
  const projectPins = useProjectPins();
  const threadSections = useThreadSections();
  const { showThreadMenu, showWorkspaceMenu, showWorktreeMenu, showCloneMenu, menu } =
    useSidebarMenus({
      onDeleteThread,
      onSyncThread,
      onPinThread: pinThread,
      onUnpinThread: unpinThread,
      isThreadPinned,
      onRenameThread,
      onReloadWorkspaceThreads,
      onDeleteWorkspace,
      onDeleteWorktree,
      workspaces,
      threadsByWorkspace,
      threadParentById,
      threadStatusById,
      sections: workspaceSections,
      onCreateSection,
      isProjectPinned: projectPins.isProjectPinned,
      onPinProject: projectPins.pinProject,
      onUnpinProject: projectPins.unpinProject,
      onEditProject,
      onAssignProjectSection: onAssignWorkspaceSection,
      getThreadSection: threadSections.getThreadSection,
      onSetThreadSection: threadSections.setThreadSection,
      onSetThreadUnread,
      onForkThread,
      loadThreadItems,
    });
  const debouncedQuery = useDebouncedValue(searchQuery, 150);
  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const isSearchActive = Boolean(normalizedQuery);
  const pendingUserInputKeys = useMemo(
    () =>
      new Set(
        userInputRequests
          .map((request) => {
            const workspaceId = request.workspace_id.trim();
            const threadId = request.params.thread_id.trim();
            return workspaceId && threadId ? `${workspaceId}:${threadId}` : "";
          })
          .filter(Boolean),
      ),
    [userInputRequests],
  );

  const isWorkspaceMatch = useCallback(
    (workspace: WorkspaceInfo) => {
      return workspaceMatchesQuery(workspace.name, normalizedQuery);
    },
    [normalizedQuery],
  );
  const workspaceHasMatchingThreadById = useMemo(() => {
    if (!isSearchActive) {
      return new Map<string, boolean>();
    }

    const result = new Map<string, boolean>();
    workspaces.forEach((workspace) => {
      const threads = threadsByWorkspace[workspace.id] ?? [];
      result.set(
        workspace.id,
        threads.some((thread) => threadMatchesQuery(thread, workspace.name, normalizedQuery)),
      );
    });
    return result;
  }, [isSearchActive, normalizedQuery, threadsByWorkspace, workspaces]);
  const workspaceVisibleDuringSearchById = useMemo(() => {
    if (!isSearchActive) {
      return new Map<string, boolean>();
    }

    const result = new Map<string, boolean>();
    workspaces.forEach((workspace) => {
      result.set(
        workspace.id,
        isWorkspaceMatch(workspace) ||
          Boolean(workspaceHasMatchingThreadById.get(workspace.id)) ||
          Boolean(threadListCursorByWorkspace[workspace.id]),
      );
    });
    return result;
  }, [
    isSearchActive,
    isWorkspaceMatch,
    workspaceHasMatchingThreadById,
    threadListCursorByWorkspace,
    workspaces,
  ]);

  const renderHighlightedName = useCallback(
    (name: string) => {
      if (!normalizedQuery) {
        return name;
      }
      const lower = name.toLowerCase();
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      let matchIndex = lower.indexOf(normalizedQuery, cursor);

      while (matchIndex !== -1) {
        if (matchIndex > cursor) {
          parts.push(name.slice(cursor, matchIndex));
        }
        parts.push(
          <span key={`${matchIndex}-${cursor}`} className="workspace-name-match">
            {name.slice(matchIndex, matchIndex + normalizedQuery.length)}
          </span>,
        );
        cursor = matchIndex + normalizedQuery.length;
        matchIndex = lower.indexOf(normalizedQuery, cursor);
      }

      if (cursor < name.length) {
        parts.push(name.slice(cursor));
      }

      return parts.length ? parts : name;
    },
    [normalizedQuery],
  );


  const refreshDisabled = workspaces.length === 0 || workspaces.every((workspace) => !workspace.connected);
  const refreshInProgress = workspaces.some(
    (workspace) => threadListLoadingByWorkspace[workspace.id] ?? false,
  );

  const pinnedThreadRows = useMemo(() => {
    type ThreadRow = { thread: ThreadSummary; depth: number };
    const groups: Array<{
      pinTime: number;
      workspaceId: string;
      workspaceName: string;
      rows: ThreadRow[];
    }> = [];

    workspaces.forEach((workspace) => {
      if (
        isSearchActive &&
        !isWorkspaceMatch(workspace) &&
        !workspaceHasMatchingThreadById.get(workspace.id)
      ) {
        return;
      }
      const threads = threadsByWorkspace[workspace.id] ?? [];
      if (!threads.length) {
        return;
      }
      const { pinnedRows } = getThreadRows(
        threads,
        true,
        workspace.id,
        getPinTimestamp,
        pinnedThreadsVersion,
      );
      if (!pinnedRows.length) {
        return;
      }
      splitRowsByRoot(pinnedRows).forEach((group) => {
        const pinTime = getPinTimestamp(workspace.id, group.root.thread.id);
        if (pinTime === null) {
          return;
        }
        groups.push({
          pinTime,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          rows: group.rows,
        });
      });
    });

    return groups
      .sort((a, b) => a.pinTime - b.pinTime)
      .filter((group) =>
        normalizedQuery
          ? group.rows.some((row) =>
              threadMatchesQuery(row.thread, group.workspaceName, normalizedQuery),
            )
          : true,
      )
      .flatMap((group) =>
        group.rows.map((row) => ({
          ...row,
          workspaceId: group.workspaceId,
        })),
      );
  }, [
    workspaces,
    threadsByWorkspace,
    getThreadRows,
    getPinTimestamp,
    pinnedThreadsVersion,
    isSearchActive,
    isWorkspaceMatch,
    normalizedQuery,
    workspaceHasMatchingThreadById,
  ]);

  const { cloneSourceIdsMatchingQuery, worktreeParentIdsMatchingQuery } = useMemo(() => {
    const cloneSourceIds = new Set<string>();
    const worktreeParentIds = new Set<string>();
    if (!isSearchActive) {
      return {
        cloneSourceIdsMatchingQuery: cloneSourceIds,
        worktreeParentIdsMatchingQuery: worktreeParentIds,
      };
    }

    workspaces.forEach((workspace) => {
      if (!workspaceVisibleDuringSearchById.get(workspace.id)) {
        return;
      }

      const sourceId = workspace.settings.cloneSourceWorkspaceId?.trim();
      if (sourceId) {
        cloneSourceIds.add(sourceId);
      }

      const parentId = workspace.parentId?.trim();
      if ((workspace.kind ?? "main") === "worktree" && parentId) {
        worktreeParentIds.add(parentId);
      }
    });

    return {
      cloneSourceIdsMatchingQuery: cloneSourceIds,
      worktreeParentIdsMatchingQuery: worktreeParentIds,
    };
  }, [isSearchActive, workspaceVisibleDuringSearchById, workspaces]);

  const filteredGroupedWorkspaces = useMemo(
    () =>
      groupedWorkspaces
        .map((group) => ({
          ...group,
          workspaces: group.workspaces.filter(
            (workspace) =>
              !isSearchActive ||
              workspaceVisibleDuringSearchById.get(workspace.id) ||
              cloneSourceIdsMatchingQuery.has(workspace.id) ||
              worktreeParentIdsMatchingQuery.has(workspace.id),
          ),
        }))
        .filter((group) => group.workspaces.length > 0),
    [
      cloneSourceIdsMatchingQuery,
      groupedWorkspaces,
      isSearchActive,
      worktreeParentIdsMatchingQuery,
      workspaceVisibleDuringSearchById,
    ],
  );

  const getSortTimestamp = useCallback(
    (thread: ThreadSummary | undefined) => {
      if (!thread) {
        return 0;
      }
      if (threadListSortKey === "created_at") {
        return thread.createdAt ?? thread.updatedAt ?? 0;
      }
      return thread.updatedAt ?? thread.createdAt ?? 0;
    },
    [threadListSortKey],
  );

  const workspaceActivityById = useMemo(() => {
    const activityById = new Map<
      string,
      {
        hasThreads: boolean;
        timestamp: number;
      }
    >();
    const workspaceById = new Map<string, WorkspaceInfo>();
    workspaces.forEach((workspace) => {
      workspaceById.set(workspace.id, workspace);
    });

    const cloneWorkspacesBySourceId = new Map<string, WorkspaceInfo[]>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "main")
      .forEach((entry) => {
        const sourceId = entry.settings.cloneSourceWorkspaceId?.trim();
        if (!sourceId || sourceId === entry.id || !workspaceById.has(sourceId)) {
          return;
        }
        const list = cloneWorkspacesBySourceId.get(sourceId) ?? [];
        list.push(entry);
        cloneWorkspacesBySourceId.set(sourceId, list);
      });

    filteredGroupedWorkspaces.forEach((group) => {
      group.workspaces.forEach((workspace) => {
        const rootThreads = threadsByWorkspace[workspace.id] ?? [];
        const visibleClones =
          normalizedQuery && !isWorkspaceMatch(workspace)
            ? (cloneWorkspacesBySourceId.get(workspace.id) ?? []).filter((clone) =>
                workspaceVisibleDuringSearchById.get(clone.id),
              )
            : (cloneWorkspacesBySourceId.get(workspace.id) ?? []);
        let hasThreads = rootThreads.length > 0;
        let timestamp = getSortTimestamp(rootThreads[0]);

        visibleClones.forEach((clone) => {
          const cloneThreads = threadsByWorkspace[clone.id] ?? [];
          if (!cloneThreads.length) {
            return;
          }
          hasThreads = true;
          timestamp = Math.max(timestamp, getSortTimestamp(cloneThreads[0]));
        });

        activityById.set(workspace.id, {
          hasThreads,
          timestamp,
        });
      });
    });
    return activityById;
  }, [
    filteredGroupedWorkspaces,
    getSortTimestamp,
    isWorkspaceMatch,
    normalizedQuery,
    threadsByWorkspace,
    workspaceVisibleDuringSearchById,
    workspaces,
  ]);

  const sortedGroupedWorkspaces = useMemo(() => {
    if (threadListOrganizeMode !== "by_project_activity") {
      return filteredGroupedWorkspaces;
    }
    return filteredGroupedWorkspaces.map((group) => ({
      ...group,
      workspaces: group.workspaces.slice().sort((a, b) => {
        const aActivity = workspaceActivityById.get(a.id) ?? {
          hasThreads: false,
          timestamp: 0,
        };
        const bActivity = workspaceActivityById.get(b.id) ?? {
          hasThreads: false,
          timestamp: 0,
        };
        if (aActivity.hasThreads !== bActivity.hasThreads) {
          return aActivity.hasThreads ? -1 : 1;
        }
        const timestampDiff = bActivity.timestamp - aActivity.timestamp;
        if (timestampDiff !== 0) {
          return timestampDiff;
        }
        return a.name.localeCompare(b.name);
      }),
    }));
  }, [filteredGroupedWorkspaces, threadListOrganizeMode, workspaceActivityById]);

  const flatThreadRootGroups = useMemo(() => {
    if (threadListOrganizeMode !== "threads_only") {
      return [] as FlatThreadRootGroup[];
    }

    const rootGroups: FlatThreadRootGroup[] = [];

    filteredGroupedWorkspaces.forEach((group) => {
      group.workspaces.forEach((workspace) => {
        const threads = threadsByWorkspace[workspace.id] ?? [];
        if (!threads.length) {
          return;
        }
        const { unpinnedRows } = getThreadRows(
          threads,
          true,
          workspace.id,
          getPinTimestamp,
          pinnedThreadsVersion,
        );
        if (!unpinnedRows.length) {
          return;
        }

        splitRowsByRoot(unpinnedRows).forEach((group) => {
          rootGroups.push({
            rootTimestamp: getSortTimestamp(group.root.thread),
            workspaceName: workspace.name,
            workspaceId: workspace.id,
            rootIndex: group.rootIndex,
            rows: group.rows.map((row) => ({
              ...row,
              workspaceId: workspace.id,
              workspaceName: workspace.name,
            })),
          });
        });
      });
    });

    return rootGroups
      .sort((a, b) => {
        const timestampDiff = b.rootTimestamp - a.rootTimestamp;
        if (timestampDiff !== 0) {
          return timestampDiff;
        }
        const workspaceNameDiff = a.workspaceName.localeCompare(b.workspaceName);
        if (workspaceNameDiff !== 0) {
          return workspaceNameDiff;
        }
        return a.rootIndex - b.rootIndex;
      })
      .filter((group) =>
        normalizedQuery
          ? group.rows.some((row) =>
              threadMatchesQuery(row.thread, row.workspaceName, normalizedQuery),
            )
          : true,
      );
  }, [
    filteredGroupedWorkspaces,
    getPinTimestamp,
    getSortTimestamp,
    getThreadRows,
    normalizedQuery,
    pinnedThreadsVersion,
    threadListOrganizeMode,
    threadsByWorkspace,
  ]);
  const flatThreadRows = useMemo(
    () => flatThreadRootGroups.flatMap((group) => group.rows),
    [flatThreadRootGroups],
  );
  const threadBuckets = useMemo(
    () => groupFlatThreadRowsByTimeBucket(flatThreadRootGroups, Date.now()),
    [flatThreadRootGroups],
  );

  const scrollFadeDeps = useMemo(
    () => [
      sortedGroupedWorkspaces,
      flatThreadRows,
      threadsByWorkspace,
      expandedWorkspaces,
      normalizedQuery,
      threadListOrganizeMode,
    ],
    [
      sortedGroupedWorkspaces,
      flatThreadRows,
      threadsByWorkspace,
      expandedWorkspaces,
      normalizedQuery,
      threadListOrganizeMode,
    ],
  );
  const { sidebarBodyRef, scrollFade, updateScrollFade } =
    useSidebarScrollFade(scrollFadeDeps);

  const workspaceNameById = useMemo(() => {
    const byId = new Map<string, string>();
    workspaces.forEach((workspace) => {
      byId.set(workspace.id, workspace.name);
    });
    return byId;
  }, [workspaces]);
  const getWorkspaceLabel = useCallback(
    (workspaceId: string) => workspaceNameById.get(workspaceId) ?? null,
    [workspaceNameById],
  );

  const groupedWorkspacesForRender =
    threadListOrganizeMode === "by_project_activity"
      ? sortedGroupedWorkspaces
      : filteredGroupedWorkspaces;
  const isThreadsOnlyMode = threadListOrganizeMode === "threads_only";

  // Chats filed under a section leave their project list and are listed under the
  // section header instead. A stored section that no longer exists means "no section".
  const sectionIds = useMemo(
    () => new Set(workspaceSections.map((section) => section.id)),
    [workspaceSections],
  );
  const { getThreadSection } = threadSections;
  const { projectThreadsByWorkspace, sectionThreadLists } = useMemo(() => {
    const lists = new Map<string, Array<{ workspaceId: string; threads: ThreadSummary[] }>>();
    if (sectionIds.size === 0) {
      return { projectThreadsByWorkspace: threadsByWorkspace, sectionThreadLists: lists };
    }
    const project: Record<string, ThreadSummary[]> = { ...threadsByWorkspace };
    workspaces.forEach((workspace) => {
      if ((workspace.kind ?? "main") !== "main" || workspace.settings.cloneSourceWorkspaceId?.trim()) {
        return;
      }
      const threads = threadsByWorkspace[workspace.id] ?? [];
      const sectionByRoot = new Map<string, string>();
      threads.forEach((thread) => {
        if (thread.isSubagent || thread.sideOf || threadParentById[thread.id]) {
          return;
        }
        const sectionId = getThreadSection(workspace.id, thread.id);
        if (sectionId && sectionIds.has(sectionId) && getPinTimestamp(workspace.id, thread.id) === null) {
          sectionByRoot.set(thread.id, sectionId);
        }
      });
      if (sectionByRoot.size === 0) {
        return;
      }
      const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
      const ownerSection = (threadId: string) => {
        const seen = new Set<string>();
        let current: string | undefined = threadId;
        while (current && !seen.has(current)) {
          seen.add(current);
          const sectionId = sectionByRoot.get(current);
          if (sectionId) {
            return sectionId;
          }
          current = threadsById.get(current)?.sideOf?.threadId ?? threadParentById[current];
        }
        return null;
      };
      const kept: ThreadSummary[] = [];
      const moved = new Map<string, ThreadSummary[]>();
      threads.forEach((thread) => {
        const sectionId = ownerSection(thread.id);
        if (!sectionId) {
          kept.push(thread);
          return;
        }
        moved.set(sectionId, [...(moved.get(sectionId) ?? []), thread]);
      });
      project[workspace.id] = kept;
      moved.forEach((movedThreads, sectionId) => {
        lists.set(sectionId, [
          ...(lists.get(sectionId) ?? []),
          { workspaceId: workspace.id, threads: movedThreads },
        ]);
      });
    });
    return { projectThreadsByWorkspace: project, sectionThreadLists: lists };
    // threadSections.version and pinnedThreadsVersion stand in for the refs read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    getPinTimestamp,
    getThreadSection,
    pinnedThreadsVersion,
    sectionIds,
    threadParentById,
    threadSections.version,
    threadsByWorkspace,
    workspaces,
  ]);
  const sectionChatRows = useMemo(() => {
    const result = new Map<string, Array<{ thread: ThreadSummary; depth: number; workspaceId: string }>>();
    sectionThreadLists.forEach((entries, sectionId) => {
      const groups = entries
        .flatMap(({ workspaceId, threads }) => {
          const workspaceName = workspaceNameById.get(workspaceId) ?? "";
          return splitRowsByRoot(
            getThreadRows(threads, true, workspaceId, getPinTimestamp, pinnedThreadsVersion).unpinnedRows,
          ).map((group) => ({
            workspaceId,
            workspaceName,
            timestamp: getSortTimestamp(group.root.thread),
            rows: group.rows,
          }));
        })
        .filter((group) =>
          normalizedQuery
            ? group.rows.some((row) => threadMatchesQuery(row.thread, group.workspaceName, normalizedQuery))
            : true,
        )
        .sort((a, b) => b.timestamp - a.timestamp);
      if (groups.length > 0) {
        result.set(
          sectionId,
          groups.flatMap((group) => group.rows.map((row) => ({ ...row, workspaceId: group.workspaceId }))),
        );
      }
    });
    return result;
  }, [
    getPinTimestamp,
    getSortTimestamp,
    getThreadRows,
    normalizedQuery,
    pinnedThreadsVersion,
    sectionThreadLists,
    workspaceNameById,
  ]);

  // Pinned projects sort first inside their section, in the order they were pinned.
  // Sections that only hold chats still get a header.
  const { isProjectPinned, getProjectPinTimestamp } = projectPins;
  const groupsForRender = useMemo(() => {
    const pinnedFirst = (list: WorkspaceInfo[]) => {
      const pinned = list
        .filter((workspace) => isProjectPinned(workspace.id))
        .sort((a, b) => (getProjectPinTimestamp(a.id) ?? 0) - (getProjectPinTimestamp(b.id) ?? 0));
      return pinned.length === 0
        ? list
        : [...pinned, ...list.filter((workspace) => !isProjectPinned(workspace.id))];
    };
    const result = groupedWorkspacesForRender.map((group) => ({
      ...group,
      workspaces: pinnedFirst(group.workspaces),
    }));
    const sectionIndex = (id: string | null) => {
      const index = workspaceSections.findIndex((section) => section.id === id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    workspaceSections.forEach((section) => {
      if (!sectionChatRows.has(section.id) || result.some((group) => group.id === section.id)) {
        return;
      }
      const at = result.findIndex((group) => sectionIndex(group.id) > sectionIndex(section.id));
      result.splice(at === -1 ? result.length : at, 0, { id: section.id, name: section.name, workspaces: [] });
    });
    return result;
    // projectPins.version stands in for the pin ref read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    getProjectPinTimestamp,
    groupedWorkspacesForRender,
    isProjectPinned,
    projectPins.version,
    sectionChatRows,
    workspaceSections,
  ]);

  const handleAllThreadsAddMenuToggle = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (allThreadsAddMenuOpen) {
        setAllThreadsAddMenuAnchor(null);
        return;
      }
      setAddMenuAnchor(null);
      const rect = event.currentTarget.getBoundingClientRect();
      const left = Math.min(
        Math.max(rect.left, 12),
        window.innerWidth - ALL_THREADS_ADD_MENU_WIDTH - 12,
      );
      const top = rect.bottom + 8;
      setAllThreadsAddMenuAnchor({
        top,
        left,
        width: ALL_THREADS_ADD_MENU_WIDTH,
      });
    },
    [allThreadsAddMenuOpen],
  );

  const handleCreateThreadInProject = useCallback(
    (workspace: WorkspaceInfo) => {
      setAllThreadsAddMenuAnchor(null);
      onAddAgent(workspace);
    },
    [onAddAgent],
  );

  const worktreesByParent = useMemo(() => {
    const worktrees = new Map<string, WorkspaceInfo[]>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "worktree" && entry.parentId)
      .forEach((entry) => {
        const parentId = entry.parentId as string;
        const list = worktrees.get(parentId) ?? [];
        list.push(entry);
        worktrees.set(parentId, list);
      });
    worktrees.forEach((entries) => {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    });
    return worktrees;
  }, [workspaces]);

  const { clonesBySource, cloneChildIds } = useMemo(() => {
    const workspaceById = new Map<string, WorkspaceInfo>();
    workspaces.forEach((workspace) => {
      workspaceById.set(workspace.id, workspace);
    });

    const clones = new Map<string, WorkspaceInfo[]>();
    const cloneIds = new Set<string>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "main")
      .forEach((entry) => {
        const sourceId = entry.settings.cloneSourceWorkspaceId?.trim();
        if (!sourceId || sourceId === entry.id || !workspaceById.has(sourceId)) {
          return;
        }
        const list = clones.get(sourceId) ?? [];
        list.push(entry);
        clones.set(sourceId, list);
        cloneIds.add(entry.id);
      });

    clones.forEach((entries) => {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    });

    return { clonesBySource: clones, cloneChildIds: cloneIds };
  }, [workspaces]);

  const projectOptionsForNewThread = useMemo(() => {
    const seen = new Set<string>();
    const projects: WorkspaceInfo[] = [];
    groupedWorkspacesForRender.forEach((group) => {
      group.workspaces.forEach((entry) => {
        if ((entry.kind ?? "main") !== "main") {
          return;
        }
        if (cloneChildIds.has(entry.id) || seen.has(entry.id)) {
          return;
        }
        seen.add(entry.id);
        projects.push(entry);
      });
    });
    return projects;
  }, [cloneChildIds, groupedWorkspacesForRender]);

  const handleToggleExpanded = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const getThreadTime = useCallback(
    (thread: ThreadSummary) => {
      const timestamp = thread.updatedAt ?? null;
      return timestamp ? formatRelativeTimeShort(timestamp) : null;
    },
    [],
  );
  const pinnedRootCount = useMemo(() => countRootRows(pinnedThreadRows), [pinnedThreadRows]);

  useEffect(() => {
    if (!addMenuAnchor) {
      return;
    }
    function handleScroll() {
      setAddMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [addMenuAnchor]);

  useEffect(() => {
    if (!allThreadsAddMenuAnchor) {
      return;
    }
    function handleScroll() {
      setAllThreadsAddMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [allThreadsAddMenuAnchor]);

  useEffect(() => {
    if (!isSearchOpen && searchQuery) {
      setSearchQuery("");
    }
  }, [isSearchOpen, searchQuery]);

  return (
    <SidebarProjects.Provider value={workspaces}><aside
      className={`sidebar${isSearchOpen ? " search-open" : ""}`}
      ref={workspaceDropTargetRef}
      onDragOver={onWorkspaceDragOver}
      onDragEnter={onWorkspaceDragEnter}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onWorkspaceDrop}
    >
      <div className="sidebar-drag-strip" />
      <SidebarHeader
        newThreadShortcut={newThreadShortcut}
        onNewThread={() => { const workspace = workspaces.find(w => w.id === activeWorkspaceId) ?? workspaces[0]; if (workspace) handleCreateThreadInProject(workspace); else onAddWorkspace(); }}
        onSelectHome={onSelectHome}
        onAddWorkspace={onAddWorkspace}
        activity={<SidebarActivity workspaces={workspaces} threadsByWorkspace={threadsByWorkspace} threadStatusById={threadStatusById} pendingUserInputKeys={pendingUserInputKeys} onSelectThread={onSelectThread} />}
        onToggleSearch={() => setIsSearchOpen((prev) => !prev)}
        isSearchOpen={isSearchOpen}
        threadListSortKey={threadListSortKey}
        onSetThreadListSortKey={onSetThreadListSortKey}
        threadListOrganizeMode={threadListOrganizeMode}
        onSetThreadListOrganizeMode={onSetThreadListOrganizeMode}
        onRefreshAllThreads={onRefreshAllThreads}
        refreshDisabled={refreshDisabled || refreshInProgress}
        refreshInProgress={refreshInProgress}
      />
      <SidebarSearchBar
        isSearchOpen={isSearchOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onClearSearch={() => setSearchQuery("")}
      />
      <div
        className={`workspace-drop-overlay${
          isWorkspaceDropActive ? " is-active" : ""
        }`}
        aria-hidden
      >
        <div
          className={`workspace-drop-overlay-text${
            workspaceDropText === "Adding Project..." ? " is-busy" : ""
          }`}
        >
          {workspaceDropText === "Drop Project Here" && (
            <FolderOpen className="workspace-drop-overlay-icon" aria-hidden />
          )}
          {workspaceDropText}
        </div>
      </div>
      <div
        className={`sidebar-body${scrollFade.top ? " fade-top" : ""}${
          scrollFade.bottom ? " fade-bottom" : ""
        }`}
        onScroll={updateScrollFade}
        ref={sidebarBodyRef}
      >
        <div className="workspace-list">
          {pinnedThreadRows.length > 0 && (
            <div className="pinned-section">
              <div className="sidebar-section-header">
                <div className="sidebar-section-title">Pinned conversations</div>
                <div className="sidebar-section-count">{pinnedRootCount}</div>
              </div>
              <PinnedThreadList
                rows={pinnedThreadRows}
                activeWorkspaceId={activeWorkspaceId}
                activeThreadId={activeThreadId}
                threadStatusById={threadStatusById}
                pendingUserInputKeys={pendingUserInputKeys}
                getThreadTime={getThreadTime}
                getThreadArgsBadge={getThreadArgsBadge}
                isThreadPinned={isThreadPinned}
                onTogglePin={togglePin}
                onSelectThread={onSelectThread}
                onShowThreadMenu={showThreadMenu}
                getWorkspaceLabel={getWorkspaceLabel}
              />
            </div>
          )}
          {isThreadsOnlyMode
            ? groupedWorkspacesForRender.length > 0 && (
                <SidebarThreadsOnlySection
                  threadBuckets={threadBuckets}
                  activeWorkspaceId={activeWorkspaceId}
                  activeThreadId={activeThreadId}
                  threadStatusById={threadStatusById}
                  pendingUserInputKeys={pendingUserInputKeys}
                  getThreadTime={getThreadTime}
                  getThreadArgsBadge={getThreadArgsBadge}
                  isThreadPinned={isThreadPinned}
                  onTogglePin={togglePin}
                  onSelectThread={onSelectThread}
                  onShowThreadMenu={showThreadMenu}
                  getWorkspaceLabel={getWorkspaceLabel}
                  addMenuOpen={allThreadsAddMenuOpen}
                  addMenuAnchor={allThreadsAddMenuAnchor}
                  addMenuRef={allThreadsAddMenuRef}
                  projectOptionsForNewThread={projectOptionsForNewThread}
                  onToggleAddMenu={handleAllThreadsAddMenuToggle}
                  onCreateThreadInProject={handleCreateThreadInProject}
                />
              )
            : (
                <SidebarWorkspaceGroups
                  groups={groupsForRender}
                  sectionChatRows={sectionChatRows}
                  isWorkspacePinned={isProjectPinned}
                  getWorkspaceLabel={getWorkspaceLabel}
                  onReorderWorkspace={threadListOrganizeMode === "by_project" ? onReorderWorkspace : undefined}
                  onMoveWorkspace={onMoveWorkspace}
                  onReorderThread={reorderThread}
                  onMoveThread={moveThread}
                  hasWorkspaceGroups={hasWorkspaceGroups}
                  collapsedGroups={collapsedGroups}
                  ungroupedCollapseId={UNGROUPED_COLLAPSE_ID}
                  toggleGroupCollapse={toggleGroupCollapse}
                  cloneChildIds={cloneChildIds}
                  clonesBySource={clonesBySource}
                  worktreesByParent={worktreesByParent}
                  workspaceVisibleDuringSearchById={workspaceVisibleDuringSearchById}
                  isSearchActive={isSearchActive}
                  normalizedQuery={normalizedQuery}
                  renderHighlightedName={renderHighlightedName}
                  isWorkspaceMatch={isWorkspaceMatch}
                  deletingWorktreeIds={deletingWorktreeIds}
                  threadsByWorkspace={projectThreadsByWorkspace}
                  threadStatusById={threadStatusById}
                  threadListLoadingByWorkspace={threadListLoadingByWorkspace}
                  threadListPagingByWorkspace={threadListPagingByWorkspace}
                  threadListCursorByWorkspace={threadListCursorByWorkspace}
                  expandedWorkspaces={expandedWorkspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  activeThreadId={activeThreadId}
                  pendingUserInputKeys={pendingUserInputKeys}
                  getThreadRows={getThreadRows}
                  getThreadTime={getThreadTime}
                  getThreadArgsBadge={getThreadArgsBadge}
                  isThreadPinned={isThreadPinned}
                  onTogglePin={togglePin}
                  getPinTimestamp={getPinTimestamp}
                  pinnedThreadsVersion={pinnedThreadsVersion}
                  addMenuAnchor={addMenuAnchor}
                  addMenuRef={addMenuRef}
                  addMenuWidth={ADD_MENU_WIDTH}
                  newAgentDraftWorkspaceId={newAgentDraftWorkspaceId}
                  startingDraftThreadWorkspaceId={startingDraftThreadWorkspaceId}
                  onSelectWorkspace={onSelectWorkspace}
                  onConnectWorkspace={onConnectWorkspace}
                  onAddAgent={onAddAgent}
                  onAddWorktreeAgent={onAddWorktreeAgent}
                  onAddCloneAgent={onAddCloneAgent}
                  onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
                  onSelectThread={onSelectThread}
                  onShowThreadMenu={showThreadMenu}
                  onShowWorkspaceMenu={showWorkspaceMenu}
                  onShowWorktreeMenu={showWorktreeMenu}
                  onShowCloneMenu={showCloneMenu}
                  onToggleExpanded={handleToggleExpanded}
                  onLoadOlderThreads={onLoadOlderThreads}
                  onToggleAddMenu={setAddMenuAnchor}
                />
              )}
          {!groupedWorkspacesForRender.length && (
            <div className="empty">
              {isSearchActive
                ? "No conversations match your search."
                : "Add a workspace to start."}
            </div>
          )}
          {isThreadsOnlyMode &&
            groupedWorkspacesForRender.length > 0 &&
            flatThreadRows.length === 0 &&
            pinnedThreadRows.length === 0 && (
              <div className="empty">No conversations yet.</div>
            )}
        </div>
      </div>
      <SidebarBottomRail
        onOpenSettings={onOpenSettings}
        onOpenDebug={onOpenDebug}
        showDebugButton={showDebugButton}
      />
      {menu}
    </aside></SidebarProjects.Provider>
  );
});

Sidebar.displayName = "Sidebar";
