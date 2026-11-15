import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {

  ConversationItem,
  ComposerSendIntent,
  FollowUpMessageBehavior,
  QueuedMessage,
  SendMessageResult,
  WorkspaceInfo,
} from "../../../types";
import { useComposerImages } from "../../composer/hooks/useComposerImages";
import { useQueuedSend } from "../../threads/hooks/useQueuedSend";
import { describeTurnError } from "../../messages/components/TurnErrorCard";
import { pushErrorToast } from "../../../services/toasts";

export function useComposerController({
  activeThreadId,
  activeTurnId,
  activeWorkspaceId,
  activeWorkspace,
  isProcessing,
  isStopping = false,
  itemsByThread,
  isReviewing,
  queueFlushPaused = false,
  steerEnabled,
  followUpMessageBehavior,

  connectWorkspace,
  startThreadForWorkspace,
  sendUserMessage,
  sendUserMessageToThread,
  startFork,
  startReview,
  startResume,
  startCompact,
  startMcp,
  startFast,
  startStatus,
  startContextCommand,
}: {
  activeThreadId: string | null;
  activeTurnId: string | null;
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  isProcessing: boolean;
  isStopping?: boolean;
  itemsByThread?: Record<string, ConversationItem[]>;
  isReviewing: boolean;
  queueFlushPaused?: boolean;
  steerEnabled: boolean;
  followUpMessageBehavior: FollowUpMessageBehavior;

  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean },
  ) => Promise<string | null>;
  sendUserMessage: (
    text: string,
    images?: string[],
    options?: { sendIntent?: ComposerSendIntent },
  ) => Promise<{ status: "sent" | "blocked" | "steer_failed" }>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
  ) => Promise<void | SendMessageResult>;
  startFork: (text: string) => Promise<void>;
  startReview: (text: string) => Promise<void>;
  startResume: (text: string) => Promise<void>;
  startCompact: (text: string) => Promise<void>;
  startMcp: (text: string) => Promise<void>;
  startFast: (text: string) => Promise<void>;
  startStatus: (text: string) => Promise<void>;
  startContextCommand: (text: string) => Promise<void>;
}) {
  const [composerDraftsByThread, setComposerDraftsByThread] = useState<
    Record<string, string>
  >({});
  const restoredFailures = useRef(new WeakSet<ConversationItem>());
  useEffect(() => {
    for (const [threadId, items] of Object.entries(itemsByThread ?? {})) {
      const item = items[items.length - 1];
      if (item?.kind !== "message" || !item.isError || !item.retryMessage || restoredFailures.current.has(item)) continue;
      restoredFailures.current.add(item);
      // A turn that ended with work to follow up on is not resent, so its request stays out of the composer.
      if (describeTurnError(item.text).canRetry === false) continue;
      const text = item.retryMessage.text;
      setComposerDraftsByThread(previous => previous[threadId]?.trim()
        ? previous : { ...previous, [threadId]: text });
    }
  }, [itemsByThread]);

  const [prefillDraft, setPrefillDraft] = useState<QueuedMessage | null>(null);
  const [composerInsert, setComposerInsert] = useState<QueuedMessage | null>(
    null,
  );

  const {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    setImagesForThread,
    removeImagesForThread,
  } = useComposerImages({ activeThreadId, activeWorkspaceId });

  const {
    activeQueue,
    handleSend: sendQueued,
    queueMessage,
    removeQueuedMessage,
    steerQueuedMessage,
  } = useQueuedSend({
    activeThreadId,
    activeTurnId,
    isProcessing,
    isStopping,
    isReviewing,
    queueFlushPaused,
    steerEnabled,
    followUpMessageBehavior,

    activeWorkspace,
    connectWorkspace,
    startThreadForWorkspace,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startCompact,
    startMcp,
    startFast,
    startStatus,
    startContextCommand,
    clearActiveImages,
  });

  const activeDraft = useMemo(
    () =>
      activeThreadId ? composerDraftsByThread[activeThreadId] ?? "" : "",
    [activeThreadId, composerDraftsByThread],
  );

  const handleDraftChange = useCallback(
    (next: string) => {
      if (!activeThreadId) {
        return;
      }
      setComposerDraftsByThread((prev) => ({
        ...prev,
        [activeThreadId]: next,
      }));
    },
    [activeThreadId],
  );

  // A send can fail before any conversation exists (the engine would not start), so there is nowhere in the
  // transcript to show why. Say what went wrong and put the request back, so it is not lost.
  const handleSend = useCallback(
    async (...args: Parameters<typeof sendQueued>) => {
      try {
        await sendQueued(...args);
      } catch (error) {
        const [text, images] = args;
        const reason = typeof error === "string" ? error : error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error);
        pushErrorToast({ title: "Message not sent", message: reason });
        setPrefillDraft({ id: `unsent-${Date.now()}`, text, images: images?.length ? images : undefined, createdAt: Date.now() });
      }
    },
    [sendQueued],
  );

  const handleSendPrompt = useCallback(
    (text: string, ) => {
      if (!text.trim()) {
        return;
      }
      void handleSend(text, []);
    },
    [handleSend],
  );

  const handleEditQueued = useCallback(
    (item: QueuedMessage) => {
      if (!activeThreadId) {
        return;
      }
      removeQueuedMessage(activeThreadId, item.id);
      setImagesForThread(activeThreadId, item.images ?? []);
      setPrefillDraft(item);
    },
    [activeThreadId, removeQueuedMessage, setImagesForThread],
  );

  const handleDeleteQueued = useCallback(
    (id: string) => {
      if (!activeThreadId) {
        return;
      }
      removeQueuedMessage(activeThreadId, id);
    },
    [activeThreadId, removeQueuedMessage],
  );

  const handleSteerQueued = useCallback(
    (id: string) => {
      if (activeThreadId) {
        void steerQueuedMessage(activeThreadId, id);
      }
    },
    [activeThreadId, steerQueuedMessage],
  );

  const clearDraftForThread = useCallback((threadId: string) => {
    setComposerDraftsByThread((prev) => {
      if (!(threadId in prev)) {
        return prev;
      }
      const { [threadId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    setImagesForThread,
    removeImagesForThread,
    activeQueue,
    handleSend,
    queueMessage,
    removeQueuedMessage,
    prefillDraft,
    setPrefillDraft,
    composerInsert,
    setComposerInsert,
    activeDraft,
    handleDraftChange,
    handleSendPrompt,
    handleEditQueued,
    handleDeleteQueued,
    handleSteerQueued,
    clearDraftForThread,
    restoreDraftForThread: (thread: string, text: string) => setComposerDraftsByThread((previous) => ({ ...previous, [thread]: text })),
  };
}
