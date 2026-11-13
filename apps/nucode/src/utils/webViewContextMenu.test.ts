/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hideWebViewContextMenu, keepsNativeContextMenu } from "./webViewContextMenu";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function element(html: string) {
  document.body.innerHTML = html;
  return document.body.querySelector("[data-target]") as HTMLElement;
}

describe("keepsNativeContextMenu", () => {
  it("keeps the menu on fields, links, pictures and the terminal", () => {
    expect(keepsNativeContextMenu(element("<input data-target />"))).toBe(true);
    expect(keepsNativeContextMenu(element("<textarea data-target></textarea>"))).toBe(true);
    expect(keepsNativeContextMenu(element('<div contenteditable="true"><b data-target>x</b></div>'))).toBe(true);
    expect(keepsNativeContextMenu(element('<a href="https://example.com"><span data-target>x</span></a>'))).toBe(true);
    expect(keepsNativeContextMenu(element("<img data-target />"))).toBe(true);
    expect(keepsNativeContextMenu(element('<div class="xterm"><div data-target></div></div>'))).toBe(true);
  });

  it("drops it on plain surfaces unless text is selected", () => {
    const plain = element("<div data-target>Section</div>");
    expect(keepsNativeContextMenu(plain)).toBe(false);
    expect(keepsNativeContextMenu(element('<div contenteditable="false" data-target>x</div>'))).toBe(false);
    expect(keepsNativeContextMenu(null)).toBe(false);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "picked" } as Selection);
    expect(keepsNativeContextMenu(plain)).toBe(true);
  });
});

describe("hideWebViewContextMenu", () => {
  it("cancels the menu on a plain surface and leaves a field alone", () => {
    hideWebViewContextMenu();
    const plain = element("<div data-target></div>");
    const onPlain = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    plain.dispatchEvent(onPlain);
    expect(onPlain.defaultPrevented).toBe(true);
    const field = element("<input data-target />");
    const onField = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    field.dispatchEvent(onField);
    expect(onField.defaultPrevented).toBe(false);
  });
});
