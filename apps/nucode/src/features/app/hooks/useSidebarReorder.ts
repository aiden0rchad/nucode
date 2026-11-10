import { useEffect, useId, useRef, useState, type HTMLAttributes } from "react";

export type DropPosition = "before" | "after";
export type ReorderRowProps = HTMLAttributes<HTMLElement> & {
  "data-reorder-id"?: string;
  "data-reorder-scope"?: string;
  "data-reorder-draggable"?: boolean;
  "data-dragging"?: boolean;
  "data-drop-edge"?: DropPosition;
};

type Target = { id: string; position: DropPosition };

export function useSidebarReorder(
  onReorder?: (id: string, targetId: string, position: DropPosition) => void,
  onMove?: (id: string, direction: "up" | "down") => void,
  { axis = "y", handle, ignore = "button, a, input" }: { axis?: "x" | "y"; handle?: string; ignore?: string } = {},
) {
  const instanceId = useId();
  const [dragged, setDragged] = useState<{ id: string; scope: string } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const clearClickRef = useRef<(() => void) | null>(null);
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;

  useEffect(() => () => {
    cleanupRef.current?.();
    clearClickRef.current?.();
  }, []);

  const suppressNextClick = () => {
    clearClickRef.current?.();
    const clear = () => {
      window.removeEventListener("click", suppress, true);
      window.removeEventListener("pointerdown", clear, true);
      clearClickRef.current = null;
    };
    const suppress = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      clear();
    };
    window.addEventListener("click", suppress, true);
    window.addEventListener("pointerdown", clear, true);
    clearClickRef.current = clear;
  };

  return (id: string, scope: string, enabled = true, canDrag = true): ReorderRowProps => {
    if (!enabled || !onReorder) return {};
    const rowScope = `${instanceId}:${scope}`;
    const targetProps: ReorderRowProps = {
      "data-reorder-id": id,
      "data-reorder-scope": rowScope,
      "data-drop-edge": dragged?.scope === rowScope && target?.id === id ? target.position : undefined,
    };
    if (!canDrag) return targetProps;
    return {
      ...targetProps,
      "data-reorder-draggable": true,
      "aria-description": onMove ? "Drag to reorder, or use Alt+ArrowUp and Alt+ArrowDown." : "Drag to reorder.",
      "data-dragging": (dragged?.id === id && dragged.scope === rowScope) || undefined,
      onPointerDown: event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        const grip = handle ? (event.target as Element).closest(handle) : null;
        if (handle ? !grip || !event.currentTarget.contains(grip) : (event.target as Element).closest(ignore)) return;
        clearClickRef.current?.();
        cleanupRef.current?.();
        const source = event.currentTarget;
        const horizontal = axis === "x";
        const offset = horizontal ? "scrollLeft" : "scrollTop";
        const size = horizontal ? "scrollWidth" : "scrollHeight";
        const clientSize = horizontal ? "clientWidth" : "clientHeight";
        const { pointerId, clientX: startX, clientY: startY } = event;
        let x = startX;
        let y = startY;
        let dragging = false;
        let hovered: Target | null = null;
        let frame = 0;
        let scrollParent = source.parentElement;
        while (scrollParent && !(/auto|scroll/.test(getComputedStyle(scrollParent)[horizontal ? "overflowX" : "overflowY"]) && scrollParent[size] > scrollParent[clientSize])) {
          scrollParent = scrollParent.parentElement;
        }
        const updateTarget = () => {
          const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-reorder-id]");
          hovered = null;
          if (row && row.dataset.reorderScope === rowScope && row.dataset.reorderId !== id) {
            const rect = row.getBoundingClientRect();
            const before = horizontal ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2;
            hovered = { id: row.dataset.reorderId!, position: before ? "before" : "after" };
          }
          document.body.classList.toggle("sidebar-reorder-invalid", !hovered);
          const next = hovered;
          setTarget(previous => previous?.id === next?.id && previous?.position === next?.position ? previous : next);
        };
        const scroll = () => {
          if (!scrollParent) return;
          const rect = scrollParent.getBoundingClientRect();
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            const coordinate = horizontal ? x : y;
            const start = horizontal ? rect.left : rect.top;
            const end = horizontal ? rect.right : rect.bottom;
            const delta = coordinate < start + 32 ? -8 : coordinate > end - 32 ? 8 : 0;
            const previous = scrollParent[offset];
            scrollParent[offset] = Math.max(0, Math.min(scrollParent[size] - scrollParent[clientSize], previous + delta));
            if (scrollParent[offset] !== previous) updateTarget();
          }
          frame = requestAnimationFrame(scroll);
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", cancel);
          window.removeEventListener("keydown", keydown);
          cancelAnimationFrame(frame);
          document.body.classList.remove("sidebar-reordering", "sidebar-reorder-invalid");
          cleanupRef.current = null;
        };
        const finish = (apply: boolean) => {
          cleanup();
          setDragged(null);
          setTarget(null);
          if (!dragging) return;
          suppressNextClick();
          if (apply && hovered) reorderRef.current?.(id, hovered.id, hovered.position);
        };
        const move = (next: PointerEvent) => {
          if (next.pointerId !== pointerId) return;
          x = next.clientX;
          y = next.clientY;
          if (!dragging) {
            if (Math.hypot(x - startX, y - startY) <= 4) return;
            dragging = true;
            setDragged({ id, scope: rowScope });
            document.body.classList.add("sidebar-reordering");
            window.getSelection()?.removeAllRanges();
            if (scrollParent) frame = requestAnimationFrame(scroll);
          }
          next.preventDefault();
          updateTarget();
        };
        const up = (next: PointerEvent) => {
          if (next.pointerId !== pointerId) return;
          if (dragging) { x = next.clientX; y = next.clientY; updateTarget(); }
          finish(true);
        };
        const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) finish(false); };
        const keydown = (next: KeyboardEvent) => {
          if (next.key === "Escape") { next.preventDefault(); finish(false); }
        };
        cleanupRef.current = cleanup;
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("keydown", keydown);
      },
      onKeyDown: event => {
        if (event.target !== event.currentTarget || !event.altKey || !onMove) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        onMove(id, event.key === "ArrowUp" ? "up" : "down");
      },
    };
  };
}
