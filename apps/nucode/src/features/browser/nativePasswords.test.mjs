import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import source from "../../../src-tauri/src/browser/native/passwords.js?raw";
import bridgeSource from "../../../src-tauri/src/browser/native/bridge.js?raw";
let page, hooks;
beforeEach(() => {
  page = new JSDOM('<form><input id="user"><input id="pass" type="password"><button>Submit</button></form>', { url: "https://example.test/login", runScripts: "outside-only" }).window;
  page.TextEncoder = TextEncoder;
  page.Element.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
  page.eval(source); hooks = page.__nuPasswords;
});
afterEach(() => page.close());
const field = id => page.document.getElementById(id);
const submit = () => page.document.querySelector("form").dispatchEvent(new page.Event("submit", { bubbles: true, cancelable: true }));
it("reinjects as a no-op, preserving captures, tracked fields and event listeners", () => {
  field("pass").value = "secret";
  field("pass").dispatchEvent(new page.Event("input", { bubbles: true }));
  field("pass").type = "text";
  submit();
  const addListener = vi.spyOn(page.document, "addEventListener");
  const observer = vi.spyOn(page, "MutationObserver");
  page.eval(source);
  expect(page.__nuPasswords).toBe(hooks);
  expect(addListener).not.toHaveBeenCalled();
  expect(observer).not.toHaveBeenCalled();
  expect(hooks.sensitive()).toBe(true);
  expect(hooks.takeCaptured().password).toBe("secret");
  expect(hooks.takeCaptured()).toBeNull();
});
it("captures on submit, returns once, and uses exact origin and nearest preceding username", () => {
  field("user").value = "alice"; field("pass").value = "private";
  submit();
  expect(hooks.takeCaptured()).toMatchObject({ origin: "https://example.test", username: "alice", password: "private" });
  expect(hooks.takeCaptured()).toBeNull();
});
it("prefers autocomplete username, excludes invisible and other-form fields", () => {
  page.document.body.innerHTML = '<form><input value="wrong"></form><form><input autocomplete="username" value="right"><input hidden value="hidden"><input value="nearest"><input id="pass" type="password" value="secret"></form>';
  field("pass").dispatchEvent(new page.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(hooks.takeCaptured().username).toBe("right");
  page.document.querySelector('[autocomplete="username"]').remove();
  field("pass").dispatchEvent(new page.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(hooks.takeCaptured().username).toBe("nearest");
});
it("captures Enter and submit controls before the site's handlers clear fields", () => {
  field("pass").value = "first";
  field("pass").dispatchEvent(new page.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(hooks.takeCaptured().password).toBe("first");
  const button = page.document.querySelector("button");
  button.addEventListener("click", e => { field("pass").value = ""; e.preventDefault(); });
  button.click();
  expect(hooks.takeCaptured().password).toBe("first");
});
it("keeps only the latest capture and expires it after 120 seconds", () => {
  field("pass").value = "one"; submit();
  field("pass").value = "two"; submit();
  expect(hooks.takeCaptured().password).toBe("two");
  submit();
  const original = page.Date.now;
  page.Date.now = () => original() + 120000;
  expect(hooks.takeCaptured()).toBeNull();
});
it("detects typed, flipped, dynamically inserted and autocomplete secrets, but permits empty or disconnected fields", () => {
  expect(hooks.sensitive()).toBe(false);
  const pass = field("pass"); pass.value = "secret";
  pass.dispatchEvent(new page.Event("input", { bubbles: true }));
  expect(hooks.sensitive()).toBe(true);
  pass.type = "text"; expect(hooks.sensitive()).toBe(true);
  pass.value = ""; expect(hooks.sensitive()).toBe(false);
  pass.remove(); pass.value = "removed"; expect(hooks.sensitive()).toBe(false);
  for (const token of ["current-password", "new-password", "one-time-code"]) {
    const input = page.document.createElement("input");
    input.autocomplete = token; input.value = "secret";
    page.document.body.append(input); expect(hooks.sensitive()).toBe(true);
    expect(hooks.isSensitive(input)).toBe(true);
    input.remove();
  }
  const dynamic = page.document.createElement("input");
  page.document.body.append(dynamic);
  dynamic.type = "password"; dynamic.type = "text"; dynamic.value = "secret";
  expect(hooks.sensitive()).toBe(true);
});
it("fills with the native setter and input/change events without exposing captured data", () => {
  const input = vi.fn(), change = vi.fn();
  field("pass").addEventListener("input", input); field("pass").addEventListener("change", change);
  expect(hooks.fill("alice", 'quote"\\secret')).toEqual({ filled: true, username: true });
  expect(field("user").value).toBe("alice"); expect(field("pass").value).toBe('quote"\\secret');
  expect(input).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
  expect(hooks.sensitive()).toBe(true); expect(hooks.takeCaptured()).toBeNull();
  field("pass").hidden = true;
  expect(hooks.fill("alice", "other")).toEqual({ filled: false, username: false });
});
it("redacts snapshots after a show-password type flip and for OTP fields", () => {
  field("pass").value = "never-return";
  field("pass").type = "text";
  field("user").autocomplete = "one-time-code"; field("user").value = "123456";
  page.eval(bridgeSource);
  const snapshot = page.__nuBrowser({ op: "snapshot" });
  expect(snapshot).not.toContain("never-return"); expect(snapshot).not.toContain("123456");
  expect(JSON.parse(snapshot).result.nodes.filter(n => n.role === "textbox").every(n => !("value" in n))).toBe(true);
});

it("hands a submission to the private native sink before document replacement", () => {
  const postMessage = vi.fn();
  page.webkit = { messageHandlers: { nucodePasswordCapture: { postMessage } } };
  field("user").value = "alice"; field("pass").value = "only-native";
  submit();
  page.document.body.innerHTML = "<p>Signed in</p>";
  expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({ origin: "https://example.test", username: "alice", password: "only-native" });
  expect(hooks.takeCaptured()).toBeNull();
});

it("redacts one-time codes without offering to save them as passwords", () => {
  field("pass").remove();
  field("user").autocomplete = "section-login one-time-code"; field("user").value = "123456";
  expect(hooks.sensitive()).toBe(true);
  submit();
  expect(hooks.takeCaptured()).toBeNull();
});
