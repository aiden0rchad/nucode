/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DictationSessionState } from "../../../types";
import { useHoldToDictate } from "./useHoldToDictate";

afterEach(() => {
  cleanup();
});

function setup(initial: DictationSessionState = "idle") {
  const startDictation = vi.fn();
  const stopDictation = vi.fn();
  const cancelDictation = vi.fn();
  const view = renderHook(
    ({ state }: { state: DictationSessionState }) =>
      useHoldToDictate({
        enabled: true,
        ready: true,
        state,
        preferredLanguage: null,
        holdKey: "alt",
        startDictation,
        stopDictation,
        cancelDictation,
      }),
    { initialProps: { state: initial } },
  );
  const key = (type: "keydown" | "keyup", init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent(type, init));
  return { startDictation, stopDictation, cancelDictation, key, setState: (state: DictationSessionState) => view.rerender({ state }) };
}

describe("useHoldToDictate", () => {
  it("records while the hold key is held alone and transcribes on release", () => {
    const { startDictation, stopDictation, cancelDictation, key, setState } = setup();
    key("keydown", { key: "Alt", altKey: true });
    expect(startDictation).toHaveBeenCalledTimes(1);
    setState("listening");
    key("keyup", { key: "Alt" });
    expect(stopDictation).toHaveBeenCalledTimes(1);
    expect(cancelDictation).not.toHaveBeenCalled();
  });

  it("drops the recording when the hold key turns out to start a shortcut", () => {
    const { startDictation, stopDictation, cancelDictation, key, setState } = setup();
    key("keydown", { key: "Alt", altKey: true });
    setState("listening");
    key("keydown", { key: "Meta", altKey: true, metaKey: true });
    key("keydown", { key: "r", altKey: true, metaKey: true });
    key("keyup", { key: "r", altKey: true, metaKey: true });
    key("keyup", { key: "Meta", altKey: true });
    key("keyup", { key: "Alt" });
    expect(startDictation).toHaveBeenCalledTimes(1);
    expect(cancelDictation).toHaveBeenCalledTimes(1);
    expect(cancelDictation).toHaveBeenCalledWith({ silent: true });
    expect(stopDictation).not.toHaveBeenCalled();
  });

  it("drops a recording that only begins after the shortcut was pressed", () => {
    const { stopDictation, cancelDictation, key, setState } = setup();
    key("keydown", { key: "Alt", altKey: true });
    key("keydown", { key: "p", altKey: true, metaKey: true });
    key("keyup", { key: "Alt" });
    expect(cancelDictation).not.toHaveBeenCalled();
    setState("listening");
    expect(cancelDictation).toHaveBeenCalledTimes(1);
    expect(cancelDictation).toHaveBeenCalledWith({ silent: true });
    expect(stopDictation).not.toHaveBeenCalled();
  });

  it("does not start when another modifier is already down", () => {
    const { startDictation, key } = setup();
    key("keydown", { key: "Meta", metaKey: true });
    key("keydown", { key: "Alt", altKey: true, metaKey: true });
    expect(startDictation).not.toHaveBeenCalled();
  });
});
