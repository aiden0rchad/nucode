import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ConversationItem } from "../../../types";
import { useStickToBottom } from "../hooks/useStickToBottom";
import { isPlanReadyTaggedMessage } from "../../../utils/internalPlanReadyMessages";
import {
  buildToolGroups,
  collapseChecklistPlans,
  computePlanFollowupState,
  parseReasoning,
  scrollKeyForItems,
} from "../utils/messageRenderUtils";

function toMarkdownQuote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n")
    .concat("\n\n");
}

type UseMessagesViewStateArgs = {
  hasOlderHistory?: boolean;
  isLoadingHistory?: boolean;
  onLoadOlderHistory?: () => Promise<void>;
  items: ConversationItem[];
  threadId: string | null;
  isThinking: boolean;
  activeUserInputRequestId: string | number | null;
  hasVisibleUserInputRequest: boolean;
  onPlanAccept?: () => void;
  onPlanSubmitChanges?: (changes: string) => void;
  onQuoteMessage?: (text: string) => void;
};

export function useMessagesViewState({
  hasOlderHistory,
  isLoadingHistory,
  onLoadOlderHistory,
  items,
  threadId,
  isThinking,
  activeUserInputRequestId,
  hasVisibleUserInputRequest,
  onPlanAccept,
  onPlanSubmitChanges,
  onQuoteMessage,
}: UseMessagesViewStateArgs) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // undefined: thread not seen yet; null: seen, no user message.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  const prependAnchor = useRef<{ threadId: string | null; firstId?: string; height: number; top: number } | null>(null);
  const loadingHistory = useRef(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const manuallyToggledExpandedRef = useRef<Set<string>>(new Set());

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Set<string>>(
    new Set(),
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [dismissedPlanFollowupByThread, setDismissedPlanFollowupByThread] =
    useState<Record<string, string>>({});

  const scrollKey = `${scrollKeyForItems(items)}-${activeUserInputRequestId ?? "no-input"}`;

  const stick = useStickToBottom(containerRef, {
    onScroll: (node) => {
      if (node.scrollTop <= 40) {
        void loadOlderHistoryRef.current();
      }
    },
  });
  const loadOlderHistoryRef = useRef<() => Promise<void>>(async () => {});

  const loadOlderHistory = useCallback(async () => {
    const container = containerRef.current;
    if (!container || !hasOlderHistory || isLoadingHistory || loadingHistory.current || !onLoadOlderHistory) {
      return;
    }
    prependAnchor.current = { threadId, firstId: items[0]?.id, height: container.scrollHeight, top: container.scrollTop };
    stick.detach();
    loadingHistory.current = true;
    try {
      await onLoadOlderHistory();
    } finally {
      loadingHistory.current = false;
    }
  }, [hasOlderHistory, isLoadingHistory, onLoadOlderHistory, threadId, items, stick]);
  loadOlderHistoryRef.current = loadOlderHistory;

  const requestAutoScroll = useCallback(() => {
    if (!stick.isAttached()) {
      return;
    }
    if (containerRef.current) {
      stick.scrollToBottom();
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [stick]);

  useLayoutEffect(() => {
    stick.attach();
    prependAnchor.current = null;
    lastUserIdRef.current = undefined;
  }, [threadId, stick]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const anchor = prependAnchor.current;
    if (container && anchor?.threadId === threadId) {
      if (isLoadingHistory) return;
      if (items[0]?.id !== anchor.firstId) {
        container.scrollTop = anchor.top + container.scrollHeight - anchor.height;
      }
      prependAnchor.current = null;
      return;
    }
    // Sending a message brings the view back to the bottom.
    const lastUser = [...items].reverse().find((item) => item.kind === "message" && item.role === "user");
    if (lastUser && lastUserIdRef.current !== undefined && lastUser.id !== lastUserIdRef.current) {
      stick.attach();
    }
    lastUserIdRef.current = lastUser?.id ?? null;
    if (!stick.isAttached()) {
      return;
    }
    if (container) {
      stick.scrollToBottom();
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [scrollKey, items, isThinking, threadId, isLoadingHistory, stick]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    manuallyToggledExpandedRef.current.add(id);
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleToolGroup = useCallback((id: string) => {
    setCollapsedToolGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCopyMessage = useCallback(
    async (item: Extract<ConversationItem, { kind: "message" }>) => {
      try {
        await navigator.clipboard.writeText(item.text);
        setCopiedMessageId(item.id);
        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopiedMessageId(null);
        }, 1200);
      } catch {
        // No-op: clipboard errors can occur in restricted contexts.
      }
    },
    [],
  );

  const handleQuoteMessage = useCallback(
    (item: Extract<ConversationItem, { kind: "message" }>, selectedText?: string) => {
      if (!onQuoteMessage) {
        return;
      }
      const sourceText = selectedText?.trim().length ? selectedText : item.text;
      const quoteText = toMarkdownQuote(sourceText);
      if (!quoteText) {
        return;
      }
      onQuoteMessage(quoteText);
    },
    [onQuoteMessage],
  );

  const reasoningMetaById = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof parseReasoning>>();
    items.forEach((item) => {
      if (item.kind === "reasoning") {
        meta.set(item.id, parseReasoning(item));
      }
    });
    return meta;
  }, [items]);

  const latestReasoningLabel = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind === "message") {
        break;
      }
      if (item.kind !== "reasoning") {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel) {
        return parsed.workingLabel;
      }
    }
    return null;
  }, [items, reasoningMetaById]);

  const { items: collapsedItems, checklistPlanIds } = useMemo(() => collapseChecklistPlans(items), [items]);
  const visibleItems = useMemo(
    () =>
      collapsedItems.filter((item) => {
        if (
          item.kind === "message" &&
          item.role === "user" &&
          isPlanReadyTaggedMessage(item.text)
        ) {
          return false;
        }
        if (item.kind !== "reasoning") {
          return true;
        }
        return reasoningMetaById.get(item.id)?.hasBody ?? false;
      }),
    [collapsedItems, reasoningMetaById],
  );

  useEffect(() => {
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const item = visibleItems[index];
      if (
        item.kind === "tool" &&
        item.toolType === "plan" &&
        (item.output ?? "").trim().length > 0
      ) {
        // A checklist snapshot is history, not a proposed plan: leave it folded.
        if (checklistPlanIds.has(item.id)) return;
        if (manuallyToggledExpandedRef.current.has(item.id)) {
          return;
        }
        setExpandedItems((prev) => {
          if (prev.has(item.id)) {
            return prev;
          }
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
        return;
      }
    }
  }, [visibleItems, checklistPlanIds]);

  const groupedItems = useMemo(() => buildToolGroups(visibleItems), [visibleItems]);

  const planFollowup = useMemo(() => {
    if (!onPlanAccept || !onPlanSubmitChanges) {
      return { shouldShow: false, planItemId: null };
    }

    const candidate = computePlanFollowupState({
      threadId,
      items,
      isThinking,
      hasVisibleUserInputRequest,
    });

    if (threadId && candidate.planItemId) {
      if (dismissedPlanFollowupByThread[threadId] === candidate.planItemId) {
        return { ...candidate, shouldShow: false };
      }
    }

    return candidate;
  }, [
    dismissedPlanFollowupByThread,
    hasVisibleUserInputRequest,
    isThinking,
    items,
    onPlanAccept,
    onPlanSubmitChanges,
    threadId,
  ]);

  const dismissPlanFollowup = useCallback(() => {
    if (!threadId || !planFollowup.planItemId) {
      return;
    }
    setDismissedPlanFollowupByThread((prev) => ({
      ...prev,
      [threadId]: planFollowup.planItemId!,
    }));
  }, [planFollowup.planItemId, threadId]);

  return {
    bottomRef,
    containerRef,
    scrollHandlers: stick.handlers,
    loadOlderHistory,
    requestAutoScroll,
    expandedItems,
    toggleExpanded,
    collapsedToolGroups,
    toggleToolGroup,
    copiedMessageId,
    handleCopyMessage,
    handleQuoteMessage,
    reasoningMetaById,
    latestReasoningLabel,
    groupedItems,
    planFollowup,
    dismissPlanFollowup,
  };
}
