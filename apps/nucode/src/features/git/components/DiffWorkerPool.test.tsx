/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: { options: unknown; terminate: ReturnType<typeof vi.fn> }[] = [];

vi.mock("@pierre/diffs/worker", () => ({
  WorkerPoolManager: class {
    terminate = vi.fn();
    constructor(public poolOptions: unknown, public options: unknown) {
      created.push({ options: { poolOptions, options }, terminate: this.terminate });
    }
  },
}));
vi.mock("../../../utils/diffsWorker", () => ({ workerFactory: () => ({}) }));

import {
  DIFF_WORKER_IDLE_TTL_MS,
  DiffWorkerPoolProvider,
  resolveDiffWorkerPoolSize,
} from "./DiffWorkerPool";

beforeEach(() => {
  vi.useFakeTimers();
  created.length = 0;
});
afterEach(() => {
  cleanup();
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("DiffWorkerPoolProvider", () => {
  it("shares one pool across providers and terminates it only after the idle TTL", () => {
    const a = render(<DiffWorkerPoolProvider>a</DiffWorkerPoolProvider>);
    const b = render(<DiffWorkerPoolProvider>b</DiffWorkerPoolProvider>);
    expect(created).toHaveLength(1);

    a.unmount();
    b.unmount();
    vi.advanceTimersByTime(DIFF_WORKER_IDLE_TTL_MS - 1);
    expect(created[0].terminate).not.toHaveBeenCalled();

    const c = render(<DiffWorkerPoolProvider>c</DiffWorkerPoolProvider>);
    vi.advanceTimersByTime(DIFF_WORKER_IDLE_TTL_MS * 2);
    expect(created).toHaveLength(1);
    expect(created[0].terminate).not.toHaveBeenCalled();

    c.unmount();
    vi.advanceTimersByTime(DIFF_WORKER_IDLE_TTL_MS);
    expect(created[0].terminate).toHaveBeenCalledTimes(1);

    render(<DiffWorkerPoolProvider>d</DiffWorkerPoolProvider>);
    expect(created).toHaveLength(2);
  });

  it("sizes the pool to half the cores, clamped to 2..6", () => {
    const cores = vi.spyOn(navigator, "hardwareConcurrency", "get");
    for (const [n, size] of [[2, 2], [8, 4], [32, 6]] as const) {
      cores.mockReturnValue(n);
      expect(resolveDiffWorkerPoolSize()).toBe(size);
    }
    cores.mockReturnValue(8);
    render(<DiffWorkerPoolProvider>x</DiffWorkerPoolProvider>);
    expect(JSON.stringify(created[0].options)).toContain('"poolSize":4');
    cores.mockRestore();
  });
});
