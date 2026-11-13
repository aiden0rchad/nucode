import { useEffect, useRef } from "react";
import { matchesHoldKey } from "../../../utils/keys";
import type { DictationSessionState } from "../../../types";

type UseHoldToDictateArgs = {
  enabled: boolean;
  ready: boolean;
  state: DictationSessionState;
  preferredLanguage: string | null;
  holdKey: string;
  startDictation: (preferredLanguage: string | null) => void | Promise<void>;
  stopDictation: () => void | Promise<void>;
  cancelDictation: (options?: { silent?: boolean }) => void | Promise<void>;
};

const HOLD_STOP_GRACE_MS = 1500;

export function useHoldToDictate({
  enabled,
  ready,
  state,
  preferredLanguage,
  holdKey,
  startDictation,
  stopDictation,
  cancelDictation,
}: UseHoldToDictateArgs) {
  const holdDictationActive = useRef(false);
  const holdDictationStopPending = useRef(false);
  const holdDictationStopTimeout = useRef<number | null>(null);
  // Set when another key joined the hold key before listening began: the recording is dropped as soon as it starts.
  const holdDictationCancelPending = useRef(false);
  const enabledRef = useRef(enabled);
  const readyRef = useRef(ready);
  const stateRef = useRef(state);
  const preferredLanguageRef = useRef(preferredLanguage);
  const holdKeyRef = useRef(holdKey.toLowerCase());
  const startDictationRef = useRef(startDictation);
  const stopDictationRef = useRef(stopDictation);
  const cancelDictationRef = useRef(cancelDictation);

  useEffect(() => {
    enabledRef.current = enabled;
    readyRef.current = ready;
    stateRef.current = state;
    preferredLanguageRef.current = preferredLanguage;
    holdKeyRef.current = holdKey.toLowerCase();
    startDictationRef.current = startDictation;
    stopDictationRef.current = stopDictation;
    cancelDictationRef.current = cancelDictation;
  }, [
    cancelDictation,
    enabled,
    holdKey,
    preferredLanguage,
    ready,
    startDictation,
    state,
    stopDictation,
  ]);

  useEffect(() => {
    if (holdDictationCancelPending.current && state === "listening") {
      holdDictationCancelPending.current = false;
      holdDictationStopPending.current = false;
      if (holdDictationStopTimeout.current !== null) {
        window.clearTimeout(holdDictationStopTimeout.current);
        holdDictationStopTimeout.current = null;
      }
      try {
        void Promise.resolve(cancelDictationRef.current({ silent: true })).catch(() => {
          // Errors are surfaced through dictation events.
        });
      } catch {
        // Errors are surfaced through dictation events.
      }
      return;
    }
    if (holdDictationStopPending.current && state === "listening") {
      holdDictationStopPending.current = false;
      if (holdDictationStopTimeout.current !== null) {
        window.clearTimeout(holdDictationStopTimeout.current);
        holdDictationStopTimeout.current = null;
      }
      try {
        void Promise.resolve(stopDictationRef.current()).catch(() => {
          // Errors are surfaced through dictation events.
        });
      } catch {
        // Errors are surfaced through dictation events.
      }
    }
  }, [state]);

  useEffect(() => {
    const safeInvoke = (action: () => void | Promise<void>) => {
      try {
        void Promise.resolve(action()).catch(() => {
          // Errors are surfaced through dictation events.
        });
      } catch {
        // Errors are surfaced through dictation events.
      }
    };

    // The hold key is a plain modifier, so it is also the first key of shortcuts such as Option+Command+R.
    // A second key means a shortcut, not speech: drop the recording without transcribing it.
    const abandonForShortcut = () => {
      holdDictationActive.current = false;
      holdDictationStopPending.current = false;
      if (holdDictationStopTimeout.current !== null) {
        window.clearTimeout(holdDictationStopTimeout.current);
        holdDictationStopTimeout.current = null;
      }
      if (stateRef.current === "listening") {
        // The user was pressing a shortcut, not dictating: no "Canceled" notice.
        safeInvoke(() => cancelDictationRef.current({ silent: true }));
        return;
      }
      holdDictationCancelPending.current = true;
      holdDictationStopTimeout.current = window.setTimeout(() => {
        holdDictationCancelPending.current = false;
        holdDictationStopTimeout.current = null;
      }, HOLD_STOP_GRACE_MS);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const normalizedHoldKey = holdKeyRef.current;
      if (!normalizedHoldKey) {
        return;
      }
      if (!matchesHoldKey(event, normalizedHoldKey)) {
        if (holdDictationActive.current) {
          abandonForShortcut();
        }
        return;
      }
      if (event.repeat) {
        return;
      }
      if (otherModifierHeld(event, normalizedHoldKey)) {
        return;
      }
      if (!enabledRef.current || !readyRef.current) {
        return;
      }
      if (stateRef.current !== "idle") {
        return;
      }
      holdDictationActive.current = true;
      holdDictationStopPending.current = false;
      holdDictationCancelPending.current = false;
      if (holdDictationStopTimeout.current !== null) {
        window.clearTimeout(holdDictationStopTimeout.current);
        holdDictationStopTimeout.current = null;
      }
      safeInvoke(() => startDictationRef.current(preferredLanguageRef.current));
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const normalizedHoldKey = holdKeyRef.current;
      if (!normalizedHoldKey || !matchesHoldKey(event, normalizedHoldKey)) {
        return;
      }
      if (!holdDictationActive.current) {
        return;
      }
      holdDictationActive.current = false;
      holdDictationStopPending.current = true;
      if (holdDictationStopTimeout.current !== null) {
        window.clearTimeout(holdDictationStopTimeout.current);
      }
      holdDictationStopTimeout.current = window.setTimeout(() => {
        holdDictationStopPending.current = false;
        holdDictationStopTimeout.current = null;
      }, HOLD_STOP_GRACE_MS);
      if (stateRef.current === "listening") {
        holdDictationStopPending.current = false;
        if (holdDictationStopTimeout.current !== null) {
          window.clearTimeout(holdDictationStopTimeout.current);
          holdDictationStopTimeout.current = null;
        }
        safeInvoke(stopDictationRef.current);
      }
    };

    const handleBlur = () => {
      if (!holdDictationActive.current) {
        return;
      }
      holdDictationActive.current = false;
      holdDictationStopPending.current = false;
      if (holdDictationStopTimeout.current !== null) {
        window.clearTimeout(holdDictationStopTimeout.current);
        holdDictationStopTimeout.current = null;
      }
      if (stateRef.current === "listening") {
        safeInvoke(() => cancelDictationRef.current());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      if (holdDictationStopTimeout.current !== null) {
        window.clearTimeout(holdDictationStopTimeout.current);
        holdDictationStopTimeout.current = null;
      }
    };
  }, []);
}

/** True when a modifier other than the hold key is already down, as in Command then Option. */
function otherModifierHeld(event: KeyboardEvent, holdKey: string) {
  return (
    (holdKey !== "alt" && event.altKey) ||
    (holdKey !== "shift" && event.shiftKey) ||
    (holdKey !== "control" && event.ctrlKey) ||
    (holdKey !== "meta" && event.metaKey)
  );
}
