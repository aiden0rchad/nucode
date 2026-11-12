import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  MAX_PINS_SOFT_LIMIT,
  STORAGE_KEY_CUSTOM_NAMES,
  STORAGE_KEY_PINNED_THREADS,
  type CustomNamesMap,
  type PinnedThreadsMap,
  type ThreadActivityMap,
  loadCustomNames,
  loadPinnedThreads,
  loadThreadActivity,
  makeCustomNameKey,
  makePinKey,
  removeCustomName,
  saveCustomName,
  savePinnedThreads,
  saveThreadActivity,
} from "@threads/utils/threadStorage";

type UseThreadStorageResult = {
  customNamesRef: MutableRefObject<CustomNamesMap>;
  pinnedThreadsRef: MutableRefObject<PinnedThreadsMap>;
  threadActivityRef: MutableRefObject<ThreadActivityMap>;
  pinnedThreadsVersion: number;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  pinThread: (workspaceId: string, threadId: string) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  /** Carries a thread's pin and custom name to its new workspace id. */
  moveThreadStorage: (fromWorkspaceId: string, toWorkspaceId: string, threadId: string) => void;
};

export function useThreadStorage(): UseThreadStorageResult {
  const threadActivityRef = useRef<ThreadActivityMap>(loadThreadActivity());
  const pinnedThreadsRef = useRef<PinnedThreadsMap>(loadPinnedThreads());
  const [pinnedThreadsVersion, setPinnedThreadsVersion] = useState(0);
  const customNamesRef = useRef<CustomNamesMap>({});

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    customNamesRef.current = loadCustomNames();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY_CUSTOM_NAMES) {
        customNamesRef.current = loadCustomNames();
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const getCustomName = useCallback((workspaceId: string, threadId: string) => {
    const key = makeCustomNameKey(workspaceId, threadId);
    return customNamesRef.current[key];
  }, []);

  const recordThreadActivity = useCallback(
    (workspaceId: string, threadId: string, timestamp = Date.now()) => {
      const nextForWorkspace = {
        ...(threadActivityRef.current[workspaceId] ?? {}),
        [threadId]: timestamp,
      };
      const next = {
        ...threadActivityRef.current,
        [workspaceId]: nextForWorkspace,
      };
      threadActivityRef.current = next;
      saveThreadActivity(next);
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    pinnedThreadsRef.current = loadPinnedThreads();
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY_PINNED_THREADS) {
        return;
      }
      pinnedThreadsRef.current = loadPinnedThreads();
      setPinnedThreadsVersion((version) => version + 1);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const pinThread = useCallback((workspaceId: string, threadId: string): boolean => {
    const key = makePinKey(workspaceId, threadId);
    if (key in pinnedThreadsRef.current) {
      return false;
    }
    const currentPinsForWorkspace = Object.keys(pinnedThreadsRef.current).filter(
      (entry) => entry.startsWith(`${workspaceId}:`),
    ).length;
    if (currentPinsForWorkspace >= MAX_PINS_SOFT_LIMIT) {
      console.warn(
        `Pin limit reached (${MAX_PINS_SOFT_LIMIT}). Consider unpinning some threads.`,
      );
    }
    const next = { ...pinnedThreadsRef.current, [key]: Date.now() };
    pinnedThreadsRef.current = next;
    savePinnedThreads(next);
    setPinnedThreadsVersion((version) => version + 1);
    return true;
  }, []);

  const unpinThread = useCallback((workspaceId: string, threadId: string) => {
    const key = makePinKey(workspaceId, threadId);
    if (!(key in pinnedThreadsRef.current)) {
      return;
    }
    const { [key]: _removed, ...rest } = pinnedThreadsRef.current;
    pinnedThreadsRef.current = rest;
    savePinnedThreads(rest);
    setPinnedThreadsVersion((version) => version + 1);
  }, []);

  const isThreadPinned = useCallback(
    (workspaceId: string, threadId: string): boolean => {
      const key = makePinKey(workspaceId, threadId);
      return key in pinnedThreadsRef.current;
    },
    [],
  );

  const getPinTimestamp = useCallback(
    (workspaceId: string, threadId: string): number | null => {
      const key = makePinKey(workspaceId, threadId);
      return pinnedThreadsRef.current[key] ?? null;
    },
    [],
  );

  const moveThreadStorage = useCallback(
    (fromWorkspaceId: string, toWorkspaceId: string, threadId: string) => {
      const from = makePinKey(fromWorkspaceId, threadId);
      const to = makePinKey(toWorkspaceId, threadId);
      if (from in pinnedThreadsRef.current) {
        const { [from]: pinnedAt, ...rest } = pinnedThreadsRef.current;
        pinnedThreadsRef.current = { ...rest, [to]: pinnedAt };
        savePinnedThreads(pinnedThreadsRef.current);
        setPinnedThreadsVersion((version) => version + 1);
      }
      const fromName = makeCustomNameKey(fromWorkspaceId, threadId);
      const name = customNamesRef.current[fromName];
      if (name !== undefined) {
        saveCustomName(toWorkspaceId, threadId, name);
        const { [fromName]: _removed, ...rest } = customNamesRef.current;
        customNamesRef.current = { ...rest, [makeCustomNameKey(toWorkspaceId, threadId)]: name };
        removeCustomName(fromWorkspaceId, threadId);
      }
    },
    [],
  );

  return {
    moveThreadStorage,
    customNamesRef,
    pinnedThreadsRef,
    threadActivityRef,
    pinnedThreadsVersion,
    getCustomName,
    recordThreadActivity,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
  };
}
