import { useCallback, useMemo, useRef } from "react";
import type { KeyboardEvent, RefObject, SyntheticEvent, TouchEvent, WheelEvent } from "react";
import { SCROLL_THRESHOLD_PX } from "../utils/messageRenderUtils";

const DETACH_KEYS = new Set(["PageUp", "ArrowUp", "Home"]);

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** True when a nested scroller under the pointer will use the wheel itself, so the transcript is not moving. */
function nestedScrollerCanScrollUp(target: EventTarget | null, root: HTMLElement) {
  for (let node = target instanceof HTMLElement ? target : null; node && node !== root; node = node.parentElement) {
    if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return true;
  }
  return false;
}

/**
 * Keeps a transcript pinned to its bottom while content streams in, until the user scrolls up.
 * "Attached" is tracked apart from "near the bottom": once the user detaches, new content never moves the view.
 */
export function useStickToBottom<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  { threshold = SCROLL_THRESHOLD_PX, onScroll }: { threshold?: number; onScroll?: (node: T) => void } = {},
) {
  const attachedRef = useRef(true);
  const lastTop = useRef(0);
  const lastHeight = useRef(0);
  const touchY = useRef<number | null>(null);
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  const attach = useCallback(() => { attachedRef.current = true; }, []);
  const detach = useCallback(() => { attachedRef.current = false; }, []);
  const isAttached = useCallback(() => attachedRef.current, []);

  const scrollToBottom = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    lastTop.current = node.scrollTop;
    lastHeight.current = node.scrollHeight;
  }, [containerRef]);

  /** Scrolls to the bottom when attached; returns whether it did. */
  const followIfAttached = useCallback(() => {
    if (!attachedRef.current) return false;
    scrollToBottom();
    return true;
  }, [scrollToBottom]);

  const handlers = useMemo(() => ({
    onWheel: (event: WheelEvent<T>) => {
      if (event.deltaY < 0 && event.currentTarget.scrollTop > 0 && !nestedScrollerCanScrollUp(event.target, event.currentTarget)) attachedRef.current = false;
    },
    onTouchStart: (event: TouchEvent<T>) => { touchY.current = event.touches[0]?.clientY ?? null; },
    onTouchMove: (event: TouchEvent<T>) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      // A finger moving down drags the content down, which scrolls the view up.
      if (touchY.current !== null && y > touchY.current && event.currentTarget.scrollTop > 0 && !nestedScrollerCanScrollUp(event.target, event.currentTarget)) attachedRef.current = false;
      touchY.current = y;
    },
    onKeyDown: (event: KeyboardEvent<T>) => {
      if (DETACH_KEYS.has(event.key) && event.currentTarget.scrollTop > 0 && !isEditable(event.target)) attachedRef.current = false;
    },
    onScroll: (event: SyntheticEvent<T>) => {
      const node = event.currentTarget;
      const top = node.scrollTop;
      const height = node.scrollHeight;
      const distance = height - top - node.clientHeight;
      const movedUp = top < lastTop.current;
      const movedDown = top > lastTop.current;
      // The browser clamps scrollTop when content shrinks; that is not the user scrolling up.
      const shrank = height < lastHeight.current;
      lastTop.current = top;
      lastHeight.current = height;
      if (movedUp && !shrank && distance > 1) attachedRef.current = false;
      else if (movedDown && distance <= threshold) attachedRef.current = true;
      onScrollRef.current?.(node);
    },
  }), [threshold]);

  return useMemo(
    () => ({ attach, detach, isAttached, scrollToBottom, followIfAttached, handlers }),
    [attach, detach, isAttached, scrollToBottom, followIfAttached, handlers],
  );
}
