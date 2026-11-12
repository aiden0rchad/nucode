/** @vitest-environment jsdom */
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadShortcuts } from "./useThreadShortcuts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const press = (init: KeyboardEventInit, target: Element | Window = window) =>
  fireEvent.keyDown(target, init);

describe("useThreadShortcuts", () => {
  it("fires the action that matches and nothing else", () => {
    const rename = vi.fn();
    const pin = vi.fn();
    const unread = vi.fn();
    renderHook(() =>
      useThreadShortcuts({
        isEnabled: true,
        shortcuts: [
          { shortcut: "ctrl+alt+r", onTrigger: rename },
          { shortcut: "ctrl+alt+p", onTrigger: pin },
          { shortcut: "ctrl+shift+u", onTrigger: unread },
        ],
      }),
    );
    press({ key: "r", ctrlKey: true, altKey: true });
    expect(rename).toHaveBeenCalledTimes(1);
    press({ key: "p", ctrlKey: true, altKey: true });
    expect(pin).toHaveBeenCalledTimes(1);
    press({ key: "u", ctrlKey: true, shiftKey: true });
    expect(unread).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);
    press({ key: "x", ctrlKey: true, altKey: true });
    expect(pin).toHaveBeenCalledTimes(1);
  });

  it("matches letters by physical key when Alt rewrites the character", () => {
    const rename = vi.fn();
    renderHook(() =>
      useThreadShortcuts({ isEnabled: true, shortcuts: [{ shortcut: "ctrl+alt+r", onTrigger: rename }] }),
    );
    press({ key: "®", code: "KeyR", ctrlKey: true, altKey: true });
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an active thread", () => {
    const rename = vi.fn();
    renderHook(() =>
      useThreadShortcuts({ isEnabled: false, shortcuts: [{ shortcut: "ctrl+alt+r", onTrigger: rename }] }),
    );
    press({ key: "r", ctrlKey: true, altKey: true });
    expect(rename).not.toHaveBeenCalled();
  });

  it("is ignored while a modal is open or a text field has focus", () => {
    const rename = vi.fn();
    renderHook(() =>
      useThreadShortcuts({ isEnabled: true, shortcuts: [{ shortcut: "ctrl+alt+r", onTrigger: rename }] }),
    );
    const input = document.createElement("input");
    document.body.append(input);
    press({ key: "r", ctrlKey: true, altKey: true }, input);
    expect(rename).not.toHaveBeenCalled();
    input.remove();
    const modal = document.createElement("div");
    modal.className = "ds-modal";
    document.body.append(modal);
    press({ key: "r", ctrlKey: true, altKey: true });
    expect(rename).not.toHaveBeenCalled();
    modal.remove();
    press({ key: "r", ctrlKey: true, altKey: true });
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("never fires a cleared shortcut", () => {
    const rename = vi.fn();
    renderHook(() =>
      useThreadShortcuts({ isEnabled: true, shortcuts: [{ shortcut: null, onTrigger: rename }, { shortcut: "", onTrigger: rename }] }),
    );
    press({ key: "r", ctrlKey: true, altKey: true });
    press({ key: "", ctrlKey: false });
    expect(rename).not.toHaveBeenCalled();
  });
});
