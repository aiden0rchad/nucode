import { createContext, useContext } from "react";

/** The conversation a thread window shows. The backend sets it before any page script runs. */
export type ThreadWindowTarget = { workspaceId: string; threadId: string };

const TARGET_KEY = "__NUCODE_THREAD_WINDOW__";

/** Reads the target from a window-like object; anything that is not two non-empty ids is "not a thread window". */
export function readThreadWindowTarget(source: object | undefined = typeof window === "undefined" ? undefined : window): ThreadWindowTarget | null {
  const value = (source as Record<string, unknown> | undefined)?.[TARGET_KEY];
  if (!value || typeof value !== "object") return null;
  const { workspaceId, threadId } = value as Record<string, unknown>;
  if (typeof workspaceId !== "string" || !workspaceId || typeof threadId !== "string" || !threadId) return null;
  return { workspaceId, threadId };
}

/** Read once, synchronously, at load: the first render already knows what kind of window it is in. */
export const threadWindowTarget = readThreadWindowTarget();

export const ThreadWindowContext = createContext<ThreadWindowTarget | null>(threadWindowTarget);

/** The target when this is a thread window, otherwise null. */
export function useThreadWindow(): ThreadWindowTarget | null {
  return useContext(ThreadWindowContext);
}

/**
 * Every effect the main window runs that a thread window must not. A call site reads its flag from
 * `useThreadWindowEffects()` and runs the effect only when the flag is true.
 *
 * Thread windows run exactly two things the main window also runs by menu or shortcut: the four composer cycles
 * and Stop. Everything else is off, so main stays the single owner of shared state and notifications.
 */
export const THREAD_WINDOW_EFFECTS = {
  /** Naming a thread from its first message. */
  titleAutogeneration: false,
  /** Publishing recent threads to the tray menu. */
  trayRecentThreads: false,
  /** Notification sounds. */
  sounds: false,
  /** System notifications, including "response required" ones. */
  systemNotifications: false,
  /** The update check and its menu event. */
  updater: false,
  /** Dictation and its hold-to-talk key. */
  dictation: false,
  /** Menu events and keyboard shortcuts for navigation, layout, workspaces and zoom. */
  menuAndShortcutListeners: false,
  /** Rename, pin, mark as unread and archive for the open thread. */
  threadShortcuts: false,
  /** Mobile server setup. */
  mobileServerSetup: false,
  /** Connecting and listing every workspace at start; a thread window only needs its own. */
  workspaceRestore: false,
  /** Answering approvals from the remembered-command list. */
  automaticApprovals: false,
  /** Writing to localStorage, which main owns. */
  sharedStorageWrites: false,
  /** Cycling model, access, reasoning and collaboration mode from the Composer menu or keys. */
  composerCycles: true,
  /** The Stop shortcut. */
  stop: true,
} as const;

export type ThreadWindowEffect = keyof typeof THREAD_WINDOW_EFFECTS;
export type ThreadWindowEffects = Record<ThreadWindowEffect, boolean>;

/** The flag for each effect: all true in the main window, `THREAD_WINDOW_EFFECTS` in a thread window. */
export function threadWindowEffects(target: ThreadWindowTarget | null): ThreadWindowEffects {
  const entries = Object.keys(THREAD_WINDOW_EFFECTS) as ThreadWindowEffect[];
  return Object.fromEntries(entries.map(name => [name, target ? THREAD_WINDOW_EFFECTS[name] : true])) as ThreadWindowEffects;
}

const MAIN_EFFECTS = threadWindowEffects(null);
const THREAD_EFFECTS = threadWindowEffects({ workspaceId: "", threadId: "" });

export function useThreadWindowEffects(): ThreadWindowEffects {
  return useThreadWindow() ? THREAD_EFFECTS : MAIN_EFFECTS;
}

/**
 * Makes `localStorage` read-only for this window. Main owns the shared state in it (sidebar, panels, pins, sections,
 * thread activity, layout); a thread window reads it and, through the `storage` event, follows it. Session storage
 * stays writable. Call once, before the app mounts.
 */
export function freezeSharedStorage(win: Window = window): () => void {
  const storage = win.localStorage;
  // Browsers keep the methods on the Storage prototype; a stand-in object may carry its own.
  const owner = (Object.prototype.hasOwnProperty.call(storage, "setItem") ? storage : Object.getPrototypeOf(storage)) as Record<string, unknown>;
  const names = ["setItem", "removeItem", "clear"] as const;
  const originals = Object.fromEntries(names.map(name => [name, owner[name]])) as Record<(typeof names)[number], (...args: unknown[]) => unknown>;
  for (const name of names) {
    owner[name] = function (this: Storage, ...args: unknown[]) {
      return this === storage ? undefined : originals[name].apply(this, args);
    };
  }
  return () => { for (const name of names) owner[name] = originals[name]; };
}
