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

  it("fires while the composer or another ordinary text field has focus", () => {
    const rename = vi.fn();
    renderHook(() =>
      useThreadShortcuts({ isEnabled: true, shortcuts: [{ shortcut: "ctrl+alt+r", onTrigger: rename }] }),
    );
    const composer = document.createElement("textarea");
    const input = document.createElement("input");
    document.body.append(composer, input);
    press({ key: "r", ctrlKey: true, altKey: true }, composer);
    press({ key: "r", ctrlKey: true, altKey: true }, input);
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it("is ignored inside a dialog, inside the context menu, and on key repeat", () => {
    const rename = vi.fn();
    renderHook(() =>
      useThreadShortcuts({ isEnabled: true, shortcuts: [{ shortcut: "ctrl+alt+r", onTrigger: rename }] }),
    );
    const menu = document.createElement("div");
    menu.setAttribute("data-ctx-menu-panel", "");
    const field = document.createElement("input");
    menu.append(field);
    document.body.append(menu);
    press({ key: "r", ctrlKey: true, altKey: true }, field);
    expect(rename).not.toHaveBeenCalled();
    menu.remove();

    press({ key: "r", ctrlKey: true, altKey: true, repeat: true });
    expect(rename).not.toHaveBeenCalled();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const prompt = document.createElement("input");
    dialog.append(prompt);
    document.body.append(dialog);
    press({ key: "r", ctrlKey: true, altKey: true }, prompt);
    press({ key: "r", ctrlKey: true, altKey: true });
    expect(rename).not.toHaveBeenCalled();
    dialog.remove();
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
