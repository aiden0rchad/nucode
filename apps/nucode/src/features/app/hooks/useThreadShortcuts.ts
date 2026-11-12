import { useEffect, useRef } from "react";
import { matchesShortcut } from "../../../utils/shortcuts";

type ThreadShortcut = {
  shortcut: string | null | undefined;
  onTrigger: () => void;
};

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
    ),
  );
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
  return Boolean(document.querySelector(".ds-modal, [aria-modal='true']"));
}

/**
 * Shortcuts that act on the active thread. They do nothing without one, while a
 * text field has focus, or while a modal is open. A cleared shortcut never fires.
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
      if (event.defaultPrevented || event.repeat || isEditableTarget(event.target) || isModalOpen()) {
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
