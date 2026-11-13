/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DictationEvent } from "../../../types";
import { useDictation } from "./useDictation";

let emit: ((event: DictationEvent) => void) | null = null;
const cancelDictation = vi.hoisted(() => vi.fn());

vi.mock("../../../services/events", () => ({
  subscribeDictationEvents: (listener: (event: DictationEvent) => void) => {
    emit = listener;
    return () => {
      emit = null;
    };
  },
}));
vi.mock("../../../services/tauri", () => ({
  cancelDictation: (...args: unknown[]) => cancelDictation(...args),
  startDictation: vi.fn(),
  stopDictation: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const canceled = () => act(() => emit?.({ type: "canceled", message: "Canceled" }));

describe("useDictation cancel", () => {
  it("shows the Canceled notice for an ordinary cancel", async () => {
    cancelDictation.mockResolvedValue("idle");
    const hook = renderHook(() => useDictation());
    await act(async () => {
      await hook.result.current.cancel();
    });
    canceled();
    expect(hook.result.current.hint).toBe("Canceled");
  });

  it("shows nothing for a silent cancel, and only for that one", async () => {
    cancelDictation.mockResolvedValue("idle");
    const hook = renderHook(() => useDictation());
    await act(async () => {
      await hook.result.current.cancel({ silent: true });
    });
    canceled();
    expect(hook.result.current.hint).toBeNull();
    canceled();
    expect(hook.result.current.hint).toBe("Canceled");
  });

  it("does not stay silent after a silent cancel that failed", async () => {
    cancelDictation.mockRejectedValue(new Error("not listening"));
    const hook = renderHook(() => useDictation());
    await act(async () => {
      await hook.result.current.cancel({ silent: true }).catch(() => {});
    });
    canceled();
    expect(hook.result.current.hint).toBe("Canceled");
  });
});
