import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import * as Sentry from "@sentry/react";
import { subscribeImportsChanged } from "@services/events";
import type {
  CollabAgentRef,
  ConversationItem,
  CustomPromptOption,
  DebugEntry,
  ServiceTier,
  ThreadListSortKey,
  ThreadSummary,
  WorkspaceInfo,
} from "@/types";
import { CHAT_SCROLLBACK_DEFAULT } from "@utils/chatScrollback";
import { useAppServerEvents } from "@app/hooks/useAppServerEvents";
import { initialState, threadReducer } from "./useThreadsReducer";
import { useThreadStorage } from "./useThreadStorage";
import { useThreadLinking } from "./useThreadLinking";
import { useThreadEventHandlers } from "./useThreadEventHandlers";
import { useThreadActions } from "./useThreadActions";
import { useThreadMessaging } from "./useThreadMessaging";
import { useThreadApprovals } from "./useThreadApprovals";
import { useThreadSelectors } from "./useThreadSelectors";
import { useThreadStatus } from "./useThreadStatus";
import { useThreadUserInput } from "./useThreadUserInput";
import { useThreadTitleAutogeneration } from "./useThreadTitleAutogeneration";
import { useDetachedReviewTracking } from "./useDetachedReviewTracking";
import {
  archiveThread as archiveThreadService,
  deleteThread as deleteThreadService,
  moveThread as moveThreadService,
  readThread as readThreadService,
  setThreadName as setThreadNameService,
} from "@services/tauri";
import {
  makeCustomNameKey,
  saveCustomName,
} from "@threads/utils/threadStorage";
import { getParentThreadIdFromThread } from "@threads/utils/threadRpc";
import {
  buildThreadSummaryFromThread,
  extractThreadFromResponse,
} from "@threads/utils/threadSummary";
import { pushErrorToast } from "@services/toasts";
import { readThreadItems } from "@threads/utils/readThreadItems";
import { getSubagentDescendantThreadIds } from "@threads/utils/subagentTree";

type UseThreadsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onWorkspaceConnected: (id: string) => void;
  onDebug?: (entry: DebugEntry) => void;
  ensureWorkspaceRuntimeCodexArgs?: (
    workspaceId: string,
    threadId: string | null,
  ) => Promise<void>;
  engine?: import("@/types").EngineKind;
  model?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: "read-only" | "current" | "full-access";
  onSelectServiceTier?: (tier: ServiceTier | null | undefined) => void;
  contextCommands?: import("./contextCommands").ContextCommandEnv;
  reviewDeliveryMode?: "inline" | "detached";
  steerEnabled?: boolean;
  threadTitleAutogenerationEnabled?: boolean;
  chatHistoryScrollbackItems?: number | null;
  customPrompts?: CustomPromptOption[];
  onMessageActivity?: () => void;
  threadSortKey?: ThreadListSortKey;
  onThreadCodexMetadataDetected?: (
    workspaceId: string,
    threadId: string,
    metadata: { modelId: string | null; effort: string | null },
  ) => void;
};

function buildWorkspaceThreadKey(workspaceId: string, threadId: string) {
  return `${workspaceId}:${threadId}`;
}

const CASCADE_ARCHIVE_SKIP_TTL_MS = 120_000;

export function useThreads({
  activeWorkspace,
  onWorkspaceConnected,
  onDebug,
  ensureWorkspaceRuntimeCodexArgs,
  engine,
  model,
  effort,
  serviceTier,
  collaborationMode,
  accessMode,
  onSelectServiceTier,
  contextCommands,
  reviewDeliveryMode = "inline",
  steerEnabled = false,
  threadTitleAutogenerationEnabled = false,
  chatHistoryScrollbackItems,
  customPrompts = [],
  onMessageActivity,
  threadSortKey = "updated_at",
  onThreadCodexMetadataDetected,
}: UseThreadsOptions) {
  const maxItemsPerThread =
    chatHistoryScrollbackItems === undefined
      ? CHAT_SCROLLBACK_DEFAULT
      : chatHistoryScrollbackItems;

  const [state, dispatch] = useReducer(
    threadReducer,
    maxItemsPerThread,
    (initialMaxItemsPerThread) => ({
      ...initialState,
      maxItemsPerThread: initialMaxItemsPerThread,
    }),
  );
  useEffect(() => {
    dispatch({ type: "setMaxItemsPerThread", maxItemsPerThread });
  }, [dispatch, maxItemsPerThread]);
  const loadedThreadsRef = useRef<Record<string, boolean>>({});
  const replaceOnResumeRef = useRef<Record<string, boolean>>({});
  const pendingInterruptsRef = useRef<Set<string>>(new Set());
  const planByThreadRef = useRef(state.planByThread);
  const itemsByThreadRef = useRef(state.itemsByThread);
  const threadsByWorkspaceRef = useRef(state.threadsByWorkspace);
  const activeTurnIdByThreadRef = useRef(state.activeTurnIdByThread);
  const subagentThreadByWorkspaceThreadRef = useRef<Record<string, true>>({});
  const threadParentByIdRef = useRef(state.threadParentById);
  const cascadeArchiveSkipRef = useRef<Record<string, number>>({});
  const subagentHydrationInFlightRef = useRef<Record<string, true>>({});
  planByThreadRef.current = state.planByThread;
  itemsByThreadRef.current = state.itemsByThread;
  threadsByWorkspaceRef.current = state.threadsByWorkspace;
  activeTurnIdByThreadRef.current = state.activeTurnIdByThread;
  threadParentByIdRef.current = state.threadParentById;
  const { approvalAllowlistRef, handleApprovalDecision, handleApprovalRemember } =
    useThreadApprovals({ dispatch, onDebug });
  const { handleUserInputSubmit } = useThreadUserInput({ dispatch });
  const {
    customNamesRef,
    threadActivityRef,
    pinnedThreadsVersion,
    getCustomName,
    recordThreadActivity,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    moveThreadStorage,
  } = useThreadStorage();

  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const { activeThreadId, activeItems } = useThreadSelectors({
    activeWorkspaceId,
    activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
    itemsByThread: state.itemsByThread,
    threadsByWorkspace: state.threadsByWorkspace,
  });



  const { markProcessing, markReviewing, setActiveTurnId } = useThreadStatus({
    dispatch,
  });

  const pushThreadErrorMessage = useCallback(
    (threadId: string, message: string, retryMessage?: { text: string; images?: string[] }, id?: string) => {
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: message,
        isError: true,
        retryMessage,
        id,
      });
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
    },
    [activeThreadId, dispatch],
  );

  const safeMessageActivity = useCallback(() => {
    try {
      void onMessageActivity?.();
    } catch {
      // Ignore refresh errors to avoid breaking the UI.
    }
  }, [onMessageActivity]);

  const setThreadLoaded = useCallback((threadId: string, isLoaded: boolean) => {
    loadedThreadsRef.current[threadId] = isLoaded;
  }, []);

  const renameThread = useCallback(
    (workspaceId: string, threadId: string, newName: string) => {
      saveCustomName(workspaceId, threadId, newName);
      const key = makeCustomNameKey(workspaceId, threadId);
      customNamesRef.current[key] = newName;
      dispatch({ type: "setThreadName", workspaceId, threadId, name: newName });
      void Promise.resolve(
        setThreadNameService(workspaceId, threadId, newName),
      ).catch((error) => {
        onDebug?.({
          id: `${Date.now()}-client-thread-rename-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/name/set error",
          payload: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [customNamesRef, dispatch, onDebug],
  );

  const onSubagentThreadDetected = useCallback(
    (workspaceId: string, threadId: string) => {
      if (!workspaceId || !threadId) {
        return;
      }
      subagentThreadByWorkspaceThreadRef.current[
        buildWorkspaceThreadKey(workspaceId, threadId)
      ] = true;
    },
    [],
  );

  const isSubagentThread = useCallback(
    (workspaceId: string, threadId: string) =>
      Boolean(
        subagentThreadByWorkspaceThreadRef.current[
          buildWorkspaceThreadKey(workspaceId, threadId)
        ],
      ),
    [],
  );

  const { applyCollabThreadLinks, applyCollabThreadLinksFromThread, updateThreadParent } =
    useThreadLinking({
      dispatch,
      threadParentById: state.threadParentById,
      onSubagentThreadDetected,
    });

  const handleWorkspaceConnected = useCallback(
    (workspaceId: string) => {
      onWorkspaceConnected(workspaceId);
    },
    [onWorkspaceConnected],
  );


  const isThreadHidden = useCallback(
    (workspaceId: string, threadId: string) =>
      Boolean(state.hiddenThreadIdsByWorkspace[workspaceId]?.[threadId]),
    [state.hiddenThreadIdsByWorkspace],
  );

  const getActiveTurnId = useCallback(
    (threadId: string) => activeTurnIdByThreadRef.current[threadId] ?? null,
    [],
  );

  const { registerDetachedReviewChild, handleReviewExited } =
    useDetachedReviewTracking({
      activeThreadId,
      dispatch,
      recordThreadActivity,
      safeMessageActivity,
      threadsByWorkspace: state.threadsByWorkspace,
      threadParentById: state.threadParentById,
      updateThreadParent,
    });

  const hydrateSubagentThreads = useCallback(
    async (workspaceId: string, receivers: CollabAgentRef[]) => {
      if (!workspaceId || receivers.length === 0) {
        return;
      }
      const uniqueThreadIds = Array.from(
        new Set(
          receivers
            .map((receiver) => receiver.threadId.trim())
            .filter((threadId) => threadId.length > 0),
        ),
      );
      if (uniqueThreadIds.length === 0) {
        return;
      }

      await Promise.all(
        uniqueThreadIds.map(async (threadId) => {
          const key = buildWorkspaceThreadKey(workspaceId, threadId);
          if (subagentHydrationInFlightRef.current[key]) {
            return;
          }
          const existingThread = threadsByWorkspaceRef.current[workspaceId]?.find(
            (thread) => thread.id === threadId,
          );
          if (existingThread?.subagentNickname && existingThread.subagentRole) {
            return;
          }

          subagentHydrationInFlightRef.current[key] = true;
          try {
            const response = await readThreadService(workspaceId, threadId);
            const thread = extractThreadFromResponse(response);
            if (!thread) {
              return;
            }
            const fallbackIndex =
              threadsByWorkspaceRef.current[workspaceId]?.length ?? 0;
            const summary = buildThreadSummaryFromThread({
              workspaceId,
              thread,
              fallbackIndex,
              getCustomName,
            });
            if (!summary) {
              return;
            }

            dispatch({ type: "ensureThread", workspaceId, threadId: summary.id });
            const preview = String(thread.preview ?? "").trim();
            const customName = getCustomName(workspaceId, summary.id);
            if (preview || customName || String(thread.name ?? "").trim()) {
              dispatch({
                type: "setThreadName",
                workspaceId,
                threadId: summary.id,
                name: summary.name,
              });
            }
            dispatch({
              type: "mergeThreadSummary",
              workspaceId,
              threadId: summary.id,
              patch: {
                ...(summary.isSubagent ? { isSubagent: true } : {}),
                ...(summary.subagentNickname
                  ? { subagentNickname: summary.subagentNickname }
                  : {}),
                ...(summary.subagentRole ? { subagentRole: summary.subagentRole } : {}),
                ...(summary.createdAt !== undefined ? { createdAt: summary.createdAt } : {}),
              },
            });
            if (summary.updatedAt > 0) {
              dispatch({
                type: "setThreadTimestamp",
                workspaceId,
                threadId: summary.id,
                timestamp: summary.updatedAt,
              });
            }
            const parentThreadId = getParentThreadIdFromThread(thread);
            if (parentThreadId) {
              updateThreadParent(parentThreadId, [summary.id]);
            }
            if (summary.isSubagent) {
              onSubagentThreadDetected(workspaceId, summary.id);
            }
          } catch (error) {
            onDebug?.({
              id: `${Date.now()}-client-thread-read-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/read error",
              payload: {
                workspaceId,
                threadId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          } finally {
            delete subagentHydrationInFlightRef.current[key];
          }
        }),
      );
    },
    [dispatch, getCustomName, onDebug, onSubagentThreadDetected, updateThreadParent],
  );

  const { onUserMessageCreated } = useThreadTitleAutogeneration({
    enabled: threadTitleAutogenerationEnabled,
    itemsByThreadRef,
    threadsByWorkspaceRef,
    getCustomName,
    renameThread,
    onDebug,
  });

  const threadHandlers = useThreadEventHandlers({
    activeThreadId,
    dispatch,
    getItemsForThread: (threadId) => itemsByThreadRef.current[threadId] ?? [],
    planByThreadRef,
    getCustomName,
    isThreadHidden,
    setThreadLoaded,
    markProcessing,
    markReviewing,
    setActiveTurnId,
    getActiveTurnId,
    safeMessageActivity,
    recordThreadActivity,
    onUserMessageCreated,
    pushThreadErrorMessage,
    onDebug,
    onWorkspaceConnected: handleWorkspaceConnected,
    applyCollabThreadLinks,
    hydrateSubagentThreads,
    onReviewExited: handleReviewExited,
    approvalAllowlistRef,
    pendingInterruptsRef,
  });


  const handleThreadStarted = useCallback(
    (workspaceId: string, thread: Record<string, unknown>) => {
      threadHandlers.onThreadStarted(workspaceId, thread);
      const threadId = String(thread.id ?? "").trim();
      if (!threadId) {
        return;
      }
      const parentThreadId = getParentThreadIdFromThread(thread);
      if (!parentThreadId) {
        return;
      }
      updateThreadParent(parentThreadId, [threadId]);
      if (!thread.sideOf) onSubagentThreadDetected(workspaceId, threadId);
    },
    [onSubagentThreadDetected, threadHandlers, updateThreadParent],
  );

  const handleThreadArchived = useCallback(
    (workspaceId: string, threadId: string) => {
      if (!workspaceId || !threadId) {
        return;
      }
      threadHandlers.onThreadArchived?.(workspaceId, threadId);
      unpinThread(workspaceId, threadId);

      const skipKey = buildWorkspaceThreadKey(workspaceId, threadId);
      const skipAt = cascadeArchiveSkipRef.current[skipKey] ?? null;
      if (skipAt !== null) {
        delete cascadeArchiveSkipRef.current[skipKey];
        if (
          skipAt > 0 &&
          Date.now() - skipAt >= 0 &&
          Date.now() - skipAt < CASCADE_ARCHIVE_SKIP_TTL_MS
        ) {
          return;
        }
      }

      const descendants = getSubagentDescendantThreadIds({
        rootThreadId: threadId,
        threadParentById: threadParentByIdRef.current,
        isSubagentThread: (candidateId) =>
          isSubagentThread(workspaceId, candidateId),
      });
      if (descendants.length === 0) {
        return;
      }

      onDebug?.({
        id: `${Date.now()}-client-thread-archive-cascade`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/archive cascade",
        payload: { workspaceId, rootThreadId: threadId, descendantCount: descendants.length },
      });

      const now = Date.now();
      Object.entries(cascadeArchiveSkipRef.current).forEach(([key, timestamp]) => {
        if (now - timestamp >= CASCADE_ARCHIVE_SKIP_TTL_MS) {
          delete cascadeArchiveSkipRef.current[key];
        }
      });

      void (async () => {
        for (const descendantId of descendants) {
          const descendantKey = buildWorkspaceThreadKey(workspaceId, descendantId);
          cascadeArchiveSkipRef.current[descendantKey] = Date.now();
          try {
            await archiveThreadService(workspaceId, descendantId);
          } catch (error) {
            delete cascadeArchiveSkipRef.current[descendantKey];
            onDebug?.({
              id: `${Date.now()}-client-thread-archive-cascade-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/archive cascade error",
              payload: {
                workspaceId,
                rootThreadId: threadId,
                threadId: descendantId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }
      })();
    },
    [isSubagentThread, onDebug, threadHandlers, unpinThread],
  );

  const handleThreadUnarchived = useCallback(
    (workspaceId: string, threadId: string) => {
      threadHandlers.onThreadUnarchived?.(workspaceId, threadId);
    },
    [threadHandlers],
  );

  const handlers = useMemo(
    () => ({
      ...threadHandlers,
      onThreadStarted: handleThreadStarted,
      onThreadArchived: handleThreadArchived,
      onThreadUnarchived: handleThreadUnarchived,
    }),
    [
      threadHandlers,
      handleThreadStarted,
      handleThreadArchived,
      handleThreadUnarchived,
    ],
  );

  useAppServerEvents(handlers);

  const {
    startThreadForWorkspace: startThreadForWorkspaceInternal,
    historyCursorByThread, historyLoadingByThread, historyErrorByThread, loadOlderHistory,
    forkThreadForWorkspace,
    resumeThreadForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    listThreadsForWorkspaces,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    archiveThread,
  } = useThreadActions({
    engine, model,
    dispatch,
    itemsByThread: state.itemsByThread,
    threadsByWorkspace: state.threadsByWorkspace,
    activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
    activeTurnIdByThread: state.activeTurnIdByThread,
    threadParentById: state.threadParentById,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    threadStatusById: state.threadStatusById,
    threadSortKey,
    onDebug,
    getCustomName,
    threadActivityRef,
    loadedThreadsRef,
    replaceOnResumeRef,
    applyCollabThreadLinksFromThread,
    updateThreadParent,
    onSubagentThreadDetected,
    onThreadCodexMetadataDetected,
  });

  useEffect(() => subscribeImportsChanged(() => {
    if (activeWorkspace?.connected) void listThreadsForWorkspace(activeWorkspace);
  }), [activeWorkspace, listThreadsForWorkspace]);

  const ensureWorkspaceRuntimeCodexArgsBestEffort = useCallback(
    async (workspaceId: string, threadId: string | null, phase: string) => {
      if (!ensureWorkspaceRuntimeCodexArgs) {
        return;
      }
      try {
        await ensureWorkspaceRuntimeCodexArgs(workspaceId, threadId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        onDebug?.({
          id: `${Date.now()}-client-thread-runtime-codex-args-sync-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/runtime-codex-args sync error",
          payload: `${phase}: ${detail}`,
        });
      }
    },
    [ensureWorkspaceRuntimeCodexArgs, onDebug],
  );

  const getWorkspaceThreadIds = useCallback(
    (workspaceId: string, includeThreadId?: string) => {
      const visibleThreadIds = (state.threadsByWorkspace[workspaceId] ?? [])
        .map((thread) => String(thread.id ?? "").trim())
        .filter((threadId) => threadId.length > 0);
      const hiddenThreadIds = Object.keys(
        state.hiddenThreadIdsByWorkspace[workspaceId] ?? {},
      );
      const activeThreadIdForWorkspace =
        state.activeThreadIdByWorkspace[workspaceId] ?? null;
      const threadIds = new Set([...visibleThreadIds, ...hiddenThreadIds]);
      if (activeThreadIdForWorkspace) {
        threadIds.add(activeThreadIdForWorkspace);
      }
      if (includeThreadId) {
        threadIds.add(includeThreadId);
      }
      return Array.from(threadIds);
    },
    [
      state.activeThreadIdByWorkspace,
      state.hiddenThreadIdsByWorkspace,
      state.threadsByWorkspace,
    ],
  );

  const hasProcessingThreadInWorkspace = useCallback(
    (workspaceId: string, excludedThreadId?: string) =>
      getWorkspaceThreadIds(workspaceId, excludedThreadId).some(
        (candidateThreadId) =>
          candidateThreadId !== excludedThreadId &&
          Boolean(state.threadStatusById[candidateThreadId]?.isProcessing),
      ),
    [getWorkspaceThreadIds, state.threadStatusById],
  );

  const shouldPreflightRuntimeCodexArgsForSend = useCallback(
    (workspaceId: string, threadId: string) =>
      !hasProcessingThreadInWorkspace(workspaceId, threadId),
    [hasProcessingThreadInWorkspace],
  );

  const startThreadForWorkspace = useCallback(
    async (workspaceId: string, options?: { activate?: boolean }) => {
      await ensureWorkspaceRuntimeCodexArgsBestEffort(workspaceId, null, "start");
      return startThreadForWorkspaceInternal(workspaceId, options);
    },
    [ensureWorkspaceRuntimeCodexArgsBestEffort, startThreadForWorkspaceInternal],
  );

  const startThread = useCallback(async () => {
    if (!activeWorkspaceId) {
      return null;
    }
    return startThreadForWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, startThreadForWorkspace]);

  const ensureThreadForActiveWorkspace = useCallback(async () => {
    if (!activeWorkspace) {
      return null;
    }
    let threadId = activeThreadId;
    if (!threadId) {
      threadId = await startThreadForWorkspace(activeWorkspace.id);
      if (!threadId) {
        return null;
      }
    } else if (!loadedThreadsRef.current[threadId]) {
      await ensureWorkspaceRuntimeCodexArgsBestEffort(
        activeWorkspace.id,
        threadId,
        "resume",
      );
      await resumeThreadForWorkspace(activeWorkspace.id, threadId);
    }
    return threadId;
  }, [
    activeWorkspace,
    activeThreadId,
    ensureWorkspaceRuntimeCodexArgsBestEffort,
    resumeThreadForWorkspace,
    startThreadForWorkspace,
  ]);

  const ensureThreadForWorkspace = useCallback(
    async (workspaceId: string) => {
      const currentActiveThreadId = state.activeThreadIdByWorkspace[workspaceId] ?? null;
      const shouldActivate = workspaceId === activeWorkspaceId;
      let threadId = currentActiveThreadId;
      if (!threadId) {
        threadId = await startThreadForWorkspace(workspaceId, {
          activate: shouldActivate,
        });
        if (!threadId) {
          return null;
        }
      } else if (!loadedThreadsRef.current[threadId]) {
        await ensureWorkspaceRuntimeCodexArgsBestEffort(workspaceId, threadId, "resume");
        await resumeThreadForWorkspace(workspaceId, threadId);
      }
      if (shouldActivate && currentActiveThreadId !== threadId) {
        dispatch({ type: "setActiveThreadId", workspaceId, threadId });
      }
      return threadId;
    },
    [
      activeWorkspaceId,
      dispatch,
      ensureWorkspaceRuntimeCodexArgsBestEffort,
      loadedThreadsRef,
      resumeThreadForWorkspace,
      startThreadForWorkspace,
      state.activeThreadIdByWorkspace,
    ],
  );

  const {
    interruptTurn,
    interruptThread,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startUncommittedReview,
    startResume,
    startCompact,
    startMcp,
    startFast,
    startStatus,
    startContextCommand,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  } = useThreadMessaging({
    threadsByWorkspace: state.threadsByWorkspace,
    tokenUsageByThread: state.tokenUsageByThread,
    activeWorkspace,
    activeThreadId,
    accessMode,
    model,
    effort,
    serviceTier,
    collaborationMode,
    onSelectServiceTier,
    contextCommands,
    reviewDeliveryMode,
    steerEnabled,
    customPrompts,
    ensureWorkspaceRuntimeCodexArgs,
    shouldPreflightRuntimeCodexArgsForSend,
    threadStatusById: state.threadStatusById,
    activeTurnIdByThread: state.activeTurnIdByThread,
    pendingInterruptsRef,
    dispatch,
    getCustomName,
    markProcessing,
    markReviewing,
    setActiveTurnId,
    recordThreadActivity,
    safeMessageActivity,
    onDebug,
    pushThreadErrorMessage,
    ensureThreadForActiveWorkspace,
    ensureThreadForWorkspace,
    refreshThread,
    forkThreadForWorkspace,
    updateThreadParent,
    registerDetachedReviewChild,
    renameThread,
  });

  const hasLocalThreadSnapshot = useCallback(
    (threadId: string | null) => {
      if (!threadId) {
        return false;
      }
      return (
        loadedThreadsRef.current[threadId] === true ||
        (itemsByThreadRef.current[threadId]?.length ?? 0) > 0
      );
    },
    [itemsByThreadRef, loadedThreadsRef],
  );

  const setActiveThreadId = useCallback(
    (threadId: string | null, workspaceId?: string) => {
      const targetId = workspaceId ?? activeWorkspaceId;
      if (!targetId) {
        return;
      }
      const currentThreadId = state.activeThreadIdByWorkspace[targetId] ?? null;
      dispatch({ type: "setActiveThreadId", workspaceId: targetId, threadId });
      if (threadId && currentThreadId !== threadId) {
        Sentry.metrics.count("thread_switched", 1, {
          attributes: {
            workspace_id: targetId,
            thread_id: threadId,
            reason: "select",
          },
        });
      }
      if (threadId) {
        void (async () => {
          const hasLocalSnapshot = hasLocalThreadSnapshot(threadId);
          if (hasLocalSnapshot) {
            loadedThreadsRef.current[threadId] = true;
            return;
          }
          const hasActiveTurnInWorkspace = hasProcessingThreadInWorkspace(targetId);
          if (!hasActiveTurnInWorkspace) {
            await ensureWorkspaceRuntimeCodexArgsBestEffort(targetId, threadId, "resume");
          }
          await resumeThreadForWorkspace(targetId, threadId);
        })();
      }
    },
    [
      activeWorkspaceId,
      ensureWorkspaceRuntimeCodexArgsBestEffort,
      hasLocalThreadSnapshot,
      hasProcessingThreadInWorkspace,
      loadedThreadsRef,
      resumeThreadForWorkspace,
      state.activeThreadIdByWorkspace,
    ],
  );

  // Archives a thread. The row leaves the list at once; if the backend refuses, it
  // comes back where it was and an error toast says why. Resolves to whether it stuck.
  const removeThread = useCallback(
    async (workspaceId: string, threadId: string): Promise<boolean> => {
      const list = threadsByWorkspaceRef.current[workspaceId] ?? [];
      const index = list.findIndex((thread) => thread.id === threadId);
      const summary = index === -1 ? null : list[index];
      const pinned = getPinTimestamp(workspaceId, threadId) !== null;
      unpinThread(workspaceId, threadId);
      dispatch({ type: "removeThread", workspaceId, threadId });
      const failure = await archiveThread(workspaceId, threadId);
      if (failure === null) {
        return true;
      }
      if (summary) {
        dispatch({ type: "restoreThread", workspaceId, thread: summary, index });
      }
      if (pinned) {
        pinThread(workspaceId, threadId);
      }
      pushErrorToast({
        title: "Couldn't archive chat",
        message: failure,
      });
      return false;
    },
    [archiveThread, getPinTimestamp, pinThread, unpinThread],
  );

  const deleteThreadPermanently = useCallback(
    async (workspaceId: string, threadId: string): Promise<boolean> => {
      try {
        await deleteThreadService(workspaceId, threadId);
      } catch (error) {
        pushErrorToast({
          title: "Couldn't delete chat",
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
      unpinThread(workspaceId, threadId);
      dispatch({ type: "removeThread", workspaceId, threadId });
      return true;
    },
    [unpinThread],
  );

  // Moves a thread to another project. Resolves to the moved thread's id on success.
  const moveThread = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      targetWorkspaceId: string,
      reportError?: (message: string) => void,
    ): Promise<boolean> => {
      const list = threadsByWorkspaceRef.current[workspaceId] ?? [];
      const summary = list.find((thread) => thread.id === threadId);
      let moved: Record<string, unknown> | null = null;
      try {
        moved = extractThreadFromResponse(await moveThreadService(workspaceId, threadId, targetWorkspaceId));
        if (!moved) {
          throw new Error("The engine did not return the moved chat");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (reportError) {
          reportError(message);
        } else {
          pushErrorToast({ title: "Couldn't move chat", message });
        }
        return false;
      }
      moveThreadStorage(workspaceId, targetWorkspaceId, threadId);
      const rebuilt = buildThreadSummaryFromThread({
        workspaceId: targetWorkspaceId,
        thread: moved,
        fallbackIndex: 0,
        getCustomName,
      });
      dispatch({
        type: "moveThread",
        fromWorkspaceId: workspaceId,
        toWorkspaceId: targetWorkspaceId,
        thread: rebuilt ?? ({ ...(summary ?? { id: threadId, name: "New Agent" }), updatedAt: Date.now() } as ThreadSummary),
      });
      return true;
    },
    [getCustomName, moveThreadStorage],
  );

  const markThreadUnread = useCallback(
    (threadId: string, hasUnread: boolean) => {
      dispatch({ type: "markUnread", threadId, hasUnread });
    },
    [],
  );

  // Items of any thread for export. A loaded thread is used as is only when its history is
  // complete; otherwise the thread is read (never resumed) and paged to the start.
  const historyCursorRef = useRef(historyCursorByThread);
  historyCursorRef.current = historyCursorByThread;
  const loadThreadItems = useCallback(
    async (workspaceId: string, threadId: string): Promise<ConversationItem[]> => {
      const loaded = itemsByThreadRef.current[threadId] ?? [];
      if (loaded.length > 0 && !historyCursorRef.current[threadId]) {
        return loaded;
      }
      return readThreadItems(workspaceId, threadId);
    },
    [itemsByThreadRef],
  );

  return {
    activeThreadId,
    markThreadUnread,
    loadThreadItems,
    deleteThreadPermanently,
    moveThread,
    historyCursorByThread, historyLoadingByThread, historyErrorByThread, loadOlderHistory,
    setActiveThreadId,
    hasLocalThreadSnapshot,
    activeItems,
    itemsByThread: state.itemsByThread,
    approvals: state.approvals,
    userInputRequests: state.userInputRequests,
    threadsByWorkspace: state.threadsByWorkspace,
    threadParentById: state.threadParentById,
    isSubagentThread,
    threadStatusById: state.threadStatusById,
    threadResumeLoadingById: state.threadResumeLoadingById,
    threadListLoadingByWorkspace: state.threadListLoadingByWorkspace,
    threadListPagingByWorkspace: state.threadListPagingByWorkspace,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    activeTurnIdByThread: state.activeTurnIdByThread,
    turnDiffByThread: state.turnDiffByThread,
    tokenUsageByThread: state.tokenUsageByThread,
    contextByThread: state.contextByThread,
    planByThread: state.planByThread,
    lastAgentMessageByThread: state.lastAgentMessageByThread,
    pinnedThreadsVersion,
    interruptTurn,
    interruptThread,
    removeThread,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    renameThread,
    startThread,
    startThreadForWorkspace,
    forkThreadForWorkspace,
    listThreadsForWorkspaces,
    listThreadsForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    loadOlderThreadsForWorkspace,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startUncommittedReview,
    startResume,
    startCompact,
    startMcp,
    startFast,
    startStatus,
    startContextCommand,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleApprovalDecision,
    handleApprovalRemember,
    handleUserInputSubmit,
  };
}
