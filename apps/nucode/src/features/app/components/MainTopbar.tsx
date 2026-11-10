import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type MainTopbarProps = {
  leftNode: ReactNode;
  actionsNode?: ReactNode;
  className?: string;
  /** Desktop: render inside the dock titlebar so Code has one toolbar row, not two. */
  inTitlebar?: boolean;
};

export const TITLEBAR_THREAD_TOOLS_ID = "titlebar-thread-tools";

export function MainTopbar({ leftNode, actionsNode, className, inTitlebar = false }: MainTopbarProps) {
  // The slot is committed with the dock titlebar before this layout effect runs; without it, render in place.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setSlot(inTitlebar ? document.getElementById(TITLEBAR_THREAD_TOOLS_ID) : null); }, [inTitlebar]);
  const classNames = ["main-topbar", slot ? "is-in-titlebar" : "", className].filter(Boolean).join(" ");
  const bar = (
    <div className={classNames} data-tauri-drag-region>
      <div className="main-topbar-left">{leftNode}</div>
      <div className="actions">{actionsNode ?? null}</div>
    </div>
  );
  return slot ? createPortal(bar, slot) : bar;
}
