import { IconButton } from "@/features/design-system/components/IconButton";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { headerActionsOverflow } from "./headerLayout";
import Ellipsis from "lucide-react/dist/esm/icons/ellipsis";
import { useMenuController } from "@app/hooks/useMenuController";

export function HeaderActions({ children }: { children: ReactNode }) {
  const menu = useMenuController();
  const [overflow, setOverflow] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = content.current?.closest<HTMLElement>(".main-header");
    if (!header || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const element = content.current;
      if (!element) return;
      // Measure the natural row even when its actions are currently in the menu.
      const previous = element.style.cssText;
      element.style.cssText += ";display:flex;position:absolute;visibility:hidden;width:max-content;flex-direction:row";
      const widths = Array.from(element.children).filter(child => getComputedStyle(child).display !== "none").map(child => Math.max(28, (child as HTMLElement).scrollWidth));
      element.style.cssText = previous;
      // In the dock titlebar the header is shrink-wrapped, so measure the room the titlebar can give it:
      // its width minus its other items, keeping 160px for the thread title.
      const titlebar = header.closest<HTMLElement>(".workspace-titlebar");
      const slot = header.closest<HTMLElement>(".titlebar-thread-tools");
      const room = titlebar && slot
        ? titlebar.getBoundingClientRect().width - 160 - Array.from(titlebar.children).filter(child => child !== slot && !child.classList.contains("titlebar-title")).reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
        : header.getBoundingClientRect().width;
      setOverflow(widths.length > 0 && headerActionsOverflow(room, widths));
    };
    const observer = new ResizeObserver(measure); observer.observe(header.closest<HTMLElement>(".workspace-titlebar") ?? header); measure();
    return () => observer.disconnect();
  }, [children]);
  const trigger = useRef<HTMLDivElement>(null);
  const { close } = menu;
  useEffect(() => { if (!overflow) close(); }, [overflow, close]);
  useEffect(() => {
    if (menu.isOpen) menu.containerRef.current?.querySelector<HTMLButtonElement>(".main-header-actions-content button:not(:disabled)")?.focus();
  }, [menu.isOpen, menu.containerRef]);
  if (!Children.toArray(children).length) return null;
  return <div className={`main-header-actions${overflow ? " has-overflow" : ""}`} ref={menu.containerRef} onKeyDown={event => {
    if (event.key === "Escape") { menu.close(); trigger.current?.querySelector("button")?.focus(); }
  }}>
    {overflow && <div className="main-header-overflow-trigger" ref={trigger}><IconButton className="ghost main-header-action" aria-expanded={menu.isOpen} aria-haspopup="dialog" aria-label="Header actions" title="More actions" onClick={menu.toggle}><Ellipsis size={14} aria-hidden /></IconButton></div>}
    <div ref={content} className={`main-header-actions-content${overflow && menu.isOpen ? " is-open" : ""}`} role={overflow && menu.isOpen ? "dialog" : undefined} aria-label={overflow && menu.isOpen ? "Header actions" : undefined}>{children}</div>
  </div>;
}
