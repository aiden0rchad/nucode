// Adapted from t3code apps/web/src/components/DiffWorkerPoolProvider.tsx
// MIT License, Copyright (c) 2026 T3 Tools Inc. (see THIRD_PARTY_T3CODE.LICENSE)
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import { useSyncExternalStore, type ReactNode } from "react";
import { DIFF_VIEWER_HIGHLIGHTER_OPTIONS } from "../../design-system/diff/diffViewerTheme";
import { workerFactory } from "../../../utils/diffsWorker";

export const DIFF_WORKER_IDLE_TTL_MS = 30_000;

export function resolveDiffWorkerPoolSize() {
  const cores =
    typeof navigator === "undefined"
      ? 4
      : Math.max(1, navigator.hardwareConcurrency || 4);
  return Math.max(2, Math.min(6, Math.floor(cores / 2)));
}

type SharedPool = {
  pool: WorkerPoolManager;
  consumers: number;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
};

let shared: SharedPool | undefined;

function acquire() {
  if (!shared) {
    // The theme is a dark/light pair; diffs pick one per render via themeType.
    const pool = new WorkerPoolManager(
      { workerFactory, poolSize: resolveDiffWorkerPoolSize() },
      { ...DIFF_VIEWER_HIGHLIGHTER_OPTIONS, tokenizeMaxLineLength: 1_000 },
    );
    shared = { pool, consumers: 0, idleTimer: undefined };
  }
  const entry = shared;
  clearTimeout(entry.idleTimer);
  entry.idleTimer = undefined;
  entry.consumers += 1;
  return entry;
}

// Module-level so the subscribe identity is stable across renders.
function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const entry = acquire();
  onStoreChange();
  return () => {
    entry.consumers -= 1;
    if (entry.consumers !== 0) return;
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = undefined;
      entry.pool.terminate();
      if (shared === entry) shared = undefined;
    }, DIFF_WORKER_IDLE_TTL_MS);
  };
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const pool = useSyncExternalStore(
    subscribe,
    () => shared?.pool,
    () => undefined,
  );
  return <WorkerPoolContext value={pool}>{children}</WorkerPoolContext>;
}
