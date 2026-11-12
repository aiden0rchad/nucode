import { useEffect, useRef } from "react";
import { matchesShortcut } from "../../../utils/shortcuts";

type ThreadShortcut = {
  shortcut: string | null | undefined;
  onTrigger: () => void;
};

// These combinations type no text, so they fire from the composer and other ordinary
// fields. The context menu's own name field is the exception.
function isMenuField(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-ctx-menu-panel]"));
}

// Option changes event.key on macOS ("r" becomes a symbol), so letters and digits are
// also matched by physical key whenever Alt is held.
function matches(event: KeyboardEvent, shortcut: string) {
  if (matchesShortcut(event, shortcut)) {
    return true;
  }
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? "");
  if (!event.altKey || !physical) {
    return false;
  }
  const { metaKey, ctrlKey, altKey, shiftKey } = event;
  return matchesShortcut(
    { key: (physical[1] ?? physical[2]).toLowerCase(), metaKey, ctrlKey, altKey, shiftKey } as KeyboardEvent,
    shortcut,
  );
}

function isModalOpen() {
  return Boolean(document.querySelector(".ds-modal, [aria-modal='true'], [role='dialog']"));
}

/**
 * Shortcuts that act on the active thread. They do nothing without one, while a
 * modal or dialog is open, inside the context menu, or on key repeat. A cleared shortcut never fires.
 */
export function useThreadShortcuts({
  isEnabled,
  shortcuts,
}: {
  isEnabled: boolean;
  shortcuts: ThreadShortcut[];
}) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (!isEnabled) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isMenuField(event.target) || isModalOpen()) {
        return;
      }
      const match = shortcutsRef.current.find(
        (entry) => entry.shortcut && matches(event, entry.shortcut),
      );
      if (!match) {
        return;
      }
      event.preventDefault();
      match.onTrigger();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled]);
}
