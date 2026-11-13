import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { PopoverSurface } from "../popover/PopoverPrimitives";
import { joinClassNames } from "../classNames";

const VIEWPORT_MARGIN = 8;
const SUBMENU_HOVER_DELAY_MS = 120;

type ItemBase = {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown as the row's `title` while the row is disabled. */
  disabledReason?: string;
};

export type ContextMenuActionItem = ItemBase & {
  kind?: "action";
  /** Right-aligned hint. Only pass a shortcut that actually works. */
  shortcut?: string;
  danger?: boolean;
  /** Renders a check in the icon column and makes the row a `menuitemcheckbox`. */
  checked?: boolean;
  onSelect: () => void;
};

export type ContextMenuSubmenuItem = ItemBase & {
  kind: "submenu";
  items: ContextMenuItem[];
};

/** A row holding a small name field; Enter submits the trimmed, non-empty value. */
export type ContextMenuInputItem = {
  kind: "input";
  id: string;
  label: string;
  placeholder: string;
  /** Text the field starts with, selected, for renaming. */
  initialValue?: string;
  /** Right-aligned note saying what Return does, for a field that starts filled in. */
  hint?: string;
  icon?: ReactNode;
  onSubmit: (value: string) => void;
};

export type ContextMenuSeparatorItem = { kind: "separator"; id: string };

export type ContextMenuItem =
  | ContextMenuActionItem
  | ContextMenuSubmenuItem
  | ContextMenuInputItem
  | ContextMenuSeparatorItem;

export type ContextMenuProps = {
  items: ContextMenuItem[];
  /** Viewport coordinates the menu opens at (usually the pointer). */
  position: { x: number; y: number };
  onClose: () => void;
  /** Receives focus again when the menu closes, unless focus already moved elsewhere. */
  returnFocusTo?: HTMLElement | null;
  label?: string;
};

type Anchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "item"; rect: DOMRect };

type PanelProps = {
  items: ContextMenuItem[];
  anchor: Anchor;
  level: number;
  label?: string;
  focusFirst: boolean;
  onCloseAll: () => void;
  onBack: () => void;
  onPanelEnter?: () => void;
};

function isFocusable(item: ContextMenuItem) {
  return item.kind !== "separator" && !("disabled" in item && item.disabled);
}

function placePanel(panel: HTMLElement, anchor: Anchor) {
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
  let left: number;
  let top: number;
  if (anchor.kind === "point") {
    left = anchor.x;
    top = anchor.y;
  } else {
    left = anchor.rect.right + 2;
    if (left > maxLeft) {
      left = anchor.rect.left - width - 2;
    }
    // Line the first row up with the parent row (panel padding plus border).
    top = anchor.rect.top - 7;
  }
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.visibility = "visible";
}

function MenuPanel({
  items,
  anchor,
  level,
  label,
  focusFirst,
  onCloseAll,
  onBack,
  onPanelEnter,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const timerRef = useRef<number | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<
    { id: string; focusFirst: boolean } | null
  >(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    placePanel(panel, anchor);
    if (focusFirst) {
      panel.querySelector<HTMLElement>("[data-ctx-focusable]")?.focus({ preventScroll: true });
    } else if (level === 0) {
      panel.focus({ preventScroll: true });
    }
    // Position and initial focus happen once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusables = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-ctx-focusable]") ?? []);

  const focusAt = (index: number) => {
    const list = focusables();
    if (list.length === 0) {
      return;
    }
    list[(index + list.length) % list.length].focus({ preventScroll: true });
  };

  const openSubmenuFor = (item: ContextMenuSubmenuItem, viaKeyboard: boolean) => {
    clearTimer();
    setOpenSubmenu({ id: item.id, focusFirst: viaKeyboard });
  };

  const activate = (item: ContextMenuItem) => {
    if (item.kind === "separator" || item.kind === "input" || !isFocusable(item)) {
      return;
    }
    if (item.kind === "submenu") {
      openSubmenuFor(item, true);
      return;
    }
    onCloseAll();
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    const target = event.target as HTMLElement;
    if (!panel || !panel.contains(target)) {
      return;
    }
    const inInput = target instanceof HTMLInputElement;
    const list = focusables();
    const index = list.indexOf(target);
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.key) {
      case "Escape":
        consume();
        onCloseAll();
        return;
      case "Tab":
        consume();
        onCloseAll();
        return;
      case "ArrowDown":
        consume();
        focusAt(index === -1 ? 0 : index + 1);
        return;
      case "ArrowUp":
        consume();
        focusAt(index === -1 ? -1 : index - 1);
        return;
      case "Home":
        if (!inInput) {
          consume();
          focusAt(0);
        }
        return;
      case "End":
        if (!inInput) {
          consume();
          focusAt(-1);
        }
        return;
      case "ArrowLeft":
        if (!inInput && level > 0) {
          consume();
          onBack();
        }
        return;
      case "ArrowRight":
      case "Enter":
      case " ": {
        if (inInput) {
          return;
        }
        const id = target.dataset.ctxId;
        const item = items.find((entry) => entry.id === id);
        if (!item) {
          return;
        }
        if (event.key === "ArrowRight" && item.kind !== "submenu") {
          return;
        }
        consume();
        activate(item);
        return;
      }
      default:
    }
  };

  const submenuItem = openSubmenu
    ? items.find(
        (item): item is ContextMenuSubmenuItem =>
          item.kind === "submenu" && item.id === openSubmenu.id,
      )
    : undefined;
  const submenuAnchor = submenuItem
    ? rowRefs.current.get(submenuItem.id)?.getBoundingClientRect()
    : undefined;

  const hoverItem = (item: ContextMenuItem, element: HTMLElement) => {
    if (item.kind === "separator") {
      return;
    }
    if (isFocusable(item) && item.kind !== "input") {
      element.focus({ preventScroll: true });
    }
    clearTimer();
    if (item.kind === "submenu" && isFocusable(item)) {
      if (openSubmenu?.id !== item.id) {
        timerRef.current = window.setTimeout(
          () => openSubmenuFor(item, false),
          SUBMENU_HOVER_DELAY_MS,
        );
      }
    } else if (openSubmenu) {
      // Leaving the submenu parent for another row closes it, after the same
      // delay that lets the pointer cross the gap on its way into the submenu.
      timerRef.current = window.setTimeout(() => setOpenSubmenu(null), SUBMENU_HOVER_DELAY_MS);
    }
  };

  return (
    <>
      {createPortal(
        <PopoverSurface
          ref={panelRef}
          className="ctx-menu"
          role="menu"
          aria-label={label}
          tabIndex={-1}
          data-ctx-menu-panel=""
          data-level={level}
          style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
          onKeyDown={onKeyDown}
          onMouseEnter={onPanelEnter}
          onContextMenu={(event) => event.preventDefault()}
        >
          {items.map((item) => {
            if (item.kind === "separator") {
              return <div key={item.id} role="separator" className="ctx-separator" />;
            }
            if (item.kind === "input") {
              return (
                <div key={item.id} role="none" className="ctx-item ctx-input-row">
                  <span className="ctx-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <input
                    className="ctx-input"
                    type="text"
                    placeholder={item.placeholder}
                    defaultValue={item.initialValue}
                    onFocus={(event) => {
                      if (item.initialValue) {
                        event.currentTarget.select();
                        event.currentTarget.dataset.selectedOnFocus = "";
                      }
                    }}
                    onMouseUp={(event) => {
                      // The click that focused the field would otherwise drop the selection again.
                      if ("selectedOnFocus" in event.currentTarget.dataset) {
                        delete event.currentTarget.dataset.selectedOnFocus;
                        event.preventDefault();
                      }
                    }}
                    aria-label={item.label}
                    data-ctx-focusable=""
                    data-ctx-id={item.id}
                    spellCheck={false}
                    autoComplete="off"
                    onMouseEnter={() => {
                      clearTimer();
                      if (openSubmenu) {
                        timerRef.current = window.setTimeout(
                          () => setOpenSubmenu(null),
                          SUBMENU_HOVER_DELAY_MS,
                        );
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        const value = event.currentTarget.value.trim();
                        if (value) {
                          onCloseAll();
                          item.onSubmit(value);
                        }
                      }
                    }}
                  />
                  {item.hint ? <span className="ctx-shortcut" aria-hidden>{item.hint}</span> : null}
                </div>
              );
            }
            const disabled = Boolean(item.disabled);
            const isSubmenu = item.kind === "submenu";
            const checked = !isSubmenu && item.checked !== undefined ? item.checked : undefined;
            const expanded = isSubmenu ? openSubmenu?.id === item.id : undefined;
            return (
              <div
                key={item.id}
                ref={(element) => {
                  if (element) {
                    rowRefs.current.set(item.id, element);
                  } else {
                    rowRefs.current.delete(item.id);
                  }
                }}
                role={checked !== undefined ? "menuitemcheckbox" : "menuitem"}
                aria-checked={checked}
                aria-disabled={disabled || undefined}
                aria-haspopup={isSubmenu ? "menu" : undefined}
                aria-expanded={expanded}
                title={disabled ? item.disabledReason : undefined}
                tabIndex={-1}
                data-ctx-focusable={disabled ? undefined : ""}
                data-ctx-id={item.id}
                className={joinClassNames(
                  "ctx-item",
                  !isSubmenu && item.danger && "is-danger",
                  disabled && "is-disabled",
                )}
                onMouseEnter={(event) => hoverItem(item, event.currentTarget)}
                onClick={(event) => {
                  event.stopPropagation();
                  activate(item);
                }}
              >
                <span className="ctx-icon" aria-hidden>
                  {checked ? <Check size={16} /> : item.icon}
                </span>
                <span className="ctx-label">{item.label}</span>
                {isSubmenu ? (
                  <ChevronRight className="ctx-chevron" size={16} aria-hidden />
                ) : item.shortcut ? (
                  <span className="ctx-shortcut">{item.shortcut}</span>
                ) : null}
              </div>
            );
          })}
        </PopoverSurface>,
        document.body,
      )}
      {submenuItem && submenuAnchor ? (
        <MenuPanel
          key={submenuItem.id}
          items={submenuItem.items}
          anchor={{ kind: "item", rect: submenuAnchor }}
          level={level + 1}
          label={submenuItem.label}
          focusFirst={Boolean(openSubmenu?.focusFirst)}
          onCloseAll={onCloseAll}
          onBack={() => {
            const parent = rowRefs.current.get(submenuItem.id);
            setOpenSubmenu(null);
            parent?.focus({ preventScroll: true });
          }}
          onPanelEnter={clearTimer}
        />
      ) : null}
    </>
  );
}

export function ContextMenu({
  items,
  position,
  onClose,
  returnFocusTo,
  label,
}: ContextMenuProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnFocusRef = useRef(returnFocusTo);
  returnFocusRef.current = returnFocusTo;

  useEffect(() => {
    const close = () => closeRef.current();
    const insidePanel = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("[data-ctx-menu-panel]"));
    const onOutside = (event: Event) => {
      if (!insidePanel(event.target)) {
        close();
      }
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (
        insidePanel(target) ||
        (target instanceof Element && target.closest("[data-marquee]"))
      ) {
        return;
      }
      close();
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("contextmenu", onOutside, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("contextmenu", onOutside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
      const row = returnFocusRef.current;
      const active = document.activeElement;
      if (
        row?.isConnected &&
        (!active || active === document.body || active.closest("[data-ctx-menu-panel]"))
      ) {
        row.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <MenuPanel
      items={items}
      anchor={{ kind: "point", x: position.x, y: position.y }}
      level={0}
      label={label}
      focusFirst={false}
      onCloseAll={onClose}
      onBack={onClose}
    />
  );
}
