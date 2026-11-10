// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import source from "../../../src-tauri/src/browser/native/bridge.js?raw";
import evaluateSource from "../../../src-tauri/src/browser/native/evaluate.js?raw";
const bridge = (params: Record<string, unknown>) => JSON.parse((window as unknown as { __nuBrowser: (p: unknown) => string }).__nuBrowser(params));
// Snapshots interleave text lines with elements, so look elements up by role rather than position.
const refOf = (role: string) => bridge({ op: "snapshot" }).result.nodes.find((n: { role: string }) => n.role === role).ref;
beforeEach(() => {
  delete (window as unknown as { __nuBrowser?: unknown }).__nuBrowser;
  document.body.innerHTML = '<main><h1>Example</h1><label for="name">Name</label><input id="name"/><button>Save</button></main>';
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  vi.stubGlobal("PointerEvent", MouseEvent);
  Element.prototype.scrollIntoView = vi.fn();
  window.eval(source);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("scrolls the page, brings refs/selectors into view, and scrolls within an element", () => {
  const pageScroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  expect(bridge({ op: "scroll", y: 400, x: null, ref: null }).error).toBeUndefined();
  expect(pageScroll).toHaveBeenCalledWith(0, 400);
  const field = document.querySelector<HTMLInputElement>("#name")!;
  field.scrollBy = vi.fn();
  const ref = refOf("textbox");
  for (const target of [ref, "#name"]) {
    expect(bridge({ op: "scroll", ref: target, x: null, y: null }).error).toBeUndefined();
  }
  expect(field.scrollIntoView).toHaveBeenCalledTimes(2);
  expect(field.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  expect(bridge({ op: "scroll", ref, x: -20, y: 50 }).error).toBeUndefined();
  expect(field.scrollBy).toHaveBeenCalledWith(-20, 50);
  expect(bridge({ op: "scroll", ref, x: 0, y: 0 }).error).toBeUndefined();
  expect(field.scrollBy).toHaveBeenLastCalledWith(0, 0);
  expect(field.scrollIntoView).toHaveBeenCalledTimes(2);
  field.remove();
  expect(bridge({ op: "scroll", ref }).error).toContain("Stale");
});
it("produces stable refs, roles, names and bounds without DOM attributes", () => {
  const first = bridge({ op: "snapshot" }).result.nodes;
  expect(first.map((n: { role: string }) => n.role)).toEqual(["main", "heading", "text", "textbox", "button"]);
  expect(first[3].name).toBe("Name");
  expect(first[3].bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  expect(bridge({ op: "snapshot" }).result.nodes[3].ref).toBe(first[3].ref);
  expect(document.querySelector('[data-nucode-ref]')).toBeNull();
});
it("clicks handlers, types using value setters and emits input/change", () => {
  const button = refOf("button"), textbox = refOf("textbox");
  const click = vi.fn(), input = vi.fn(), change = vi.fn();
  document.querySelector("button")!.addEventListener("click", click);
  const field = document.querySelector("input")!;
  field.addEventListener("input", input); field.addEventListener("change", change);
  expect(bridge({ op: "click", ref: button })).toEqual({ result: { performed: true } });
  expect(click).toHaveBeenCalledOnce();
  expect(bridge({ op: "type", ref: textbox, text: "hello" })).toEqual({ result: { performed: true } });
  expect(field.value).toBe("hello"); expect(input).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
  field.remove(); expect(bridge({ op: "type", ref: textbox, text: "bad" }).error).toContain("Stale");
});
it("caps nodes and encoded bytes and excludes password values", () => {
  document.body.innerHTML = '<input type="password" value="secret"/>' + '<button>Go</button>'.repeat(1600);
  let result = bridge({ op: "snapshot" }).result;
  expect(result.nodes).toHaveLength(1500); expect(result.truncated).toBe(true); expect(result.nodes[0].value).toBeUndefined();
  document.body.innerHTML = `<button>${"界".repeat(1000)}</button>`.repeat(200);
  result = bridge({ op: "snapshot" }).result;
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(200000);
  expect(result.truncated).toBe(true);
});
it("selects options, edits with common keys, and rejects unknown options", () => {
  document.body.innerHTML = '<input value="abc"/><select><option value="one">One</option><option value="two">Two</option></select>';
  const nodes = bridge({ op: "snapshot" }).result.nodes;
  const input = document.querySelector("input")!; input.focus(); input.setSelectionRange(3, 3);
  bridge({ op: "press", key: "Backspace" }); expect(input.value).toBe("ab");
  bridge({ op: "press", key: "ControlOrMeta+a" }); bridge({ op: "press", key: "x" }); expect(input.value).toBe("x");
  bridge({ op: "select", ref: nodes[1].ref, values: ["two"] }); expect(document.querySelector("select")!.value).toBe("two");
  expect(bridge({ op: "select", ref: nodes[1].ref, values: ["missing"] }).error).toContain("Unknown option");
});
it("sends legacy keyCode and code with pressed keys", () => {
  document.body.innerHTML = "<button>Close</button>";
  const seen: Array<[string, string, number, number]> = [];
  document.addEventListener("keydown", e => seen.push([e.key, e.code, e.keyCode, e.which]));
  for (const key of ["Escape", "Enter", "Space", "a", "7", "Shift+Tab", "F5"]) bridge({ op: "press", key });
  expect(seen).toEqual([["Escape", "Escape", 27, 27], ["Enter", "Enter", 13, 13], [" ", "Space", 32, 32], ["a", "KeyA", 65, 65], ["7", "Digit7", 55, 55], ["Tab", "Tab", 9, 9], ["F5", "F5", 0, 0]]);
});
it.each(["stat1", "STAT-101 Intro Statistics", "Course text"])("selects an option by value, label or trimmed text: %s", value => {
  document.body.innerHTML = '<select><option value="other">Other</option><option value="stat1" label="STAT-101 Intro Statistics">  Course text  </option></select>';
  const select = document.querySelector("select")!;
  const input = vi.fn(), change = vi.fn();
  select.addEventListener("input", input); select.addEventListener("change", change);
  expect(bridge({ op: "select", ref: "select", values: [value] })).toMatchObject({ result: { performed: true } });
  expect(select.value).toBe("stat1");
  expect(input).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
});
it("prioritizes values then labels then text, selecting the first enabled match", () => {
  document.body.innerHTML = '<select multiple><option value="text" label="Different">Match</option><option value="label" label="Match">Other</option><option value="Match" disabled>Disabled</option><optgroup disabled><option value="Match">Disabled group</option></optgroup><option value="Match">Value</option><option value="Match">Duplicate</option></select>';
  const select = document.querySelector("select")!;
  expect(bridge({ op: "select", ref: "select", values: ["Match"] }).error).toBeUndefined();
  expect([...select.selectedOptions]).toEqual([select.options[4]]);
  select.options[4].disabled = true; select.options[5].disabled = true;
  expect(bridge({ op: "select", ref: "select", values: ["Match"] }).error).toBeUndefined();
  expect([...select.selectedOptions]).toEqual([select.options[1]]);
  select.options[1].disabled = true;
  expect(bridge({ op: "select", ref: "select", values: ["Match"] }).error).toBeUndefined();
  expect([...select.selectedOptions]).toEqual([select.options[0]]);
});
it("supports mixed multi-select matches and rejects disabled or missing options without changing selection", () => {
  document.body.innerHTML = '<select multiple><option value="one" label="One">First</option><option value="two" label="Two">Second</option><option value="three" label="Three"> Third </option><option value="off" label="Off" disabled>Disabled</option><optgroup disabled><option value="group" label="Group">Grouped</option></optgroup></select>';
  const select = document.querySelector("select")!;
  const change = vi.fn(); select.addEventListener("change", change);
  expect(bridge({ op: "select", ref: "select", values: ["one", "Two", "Third"] }).error).toBeUndefined();
  expect([...select.selectedOptions].map(o => o.value)).toEqual(["one", "two", "three"]);
  for (const value of ["missing", "off", "Off", "Disabled", "group", "Group", "Grouped"]) {
    expect(bridge({ op: "select", ref: "select", values: ["one", value] }).error).toContain("Unknown option or option is disabled");
    expect([...select.selectedOptions].map(o => o.value)).toEqual(["one", "two", "three"]);
  }
  expect(change).toHaveBeenCalledOnce();
});
it("resolves unique CSS selectors and rejects ambiguous selectors and stale refs", () => {
  const click = vi.fn(); document.querySelector("button")!.addEventListener("click", click);
  expect(bridge({ op: "click", ref: "button" }).error).toBeUndefined();
  expect(click).toHaveBeenCalledOnce();
  document.body.insertAdjacentHTML("beforeend", "<button>Other</button>");
  expect(bridge({ op: "click", ref: "button" }).error).toContain("matched 2");
  expect(bridge({ op: "click", ref: "e999" }).error).toContain("Stale");
  expect(bridge({ op: "type", ref: "#name", text: "Fern" }).error).toBeUndefined();
  expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("Fern");
});
it("fills the advertised textbox, checkbox, radio, combobox and slider fields", () => {
  document.body.innerHTML = '<input id="user"/><input id="pass" type="password"/><input id="check" type="checkbox"/><input id="radio" type="radio"/><select id="choice"><option value="sun">Sunny</option><option value="shade">Shady</option></select><input id="range" type="range"/>';
  const input = vi.fn(), change = vi.fn();
  document.body.addEventListener("input", input); document.body.addEventListener("change", change);
  const fields = [
    { target: "#user", name: "Username", type: "textbox", value: "demo" },
    { target: "#pass", name: "Password", type: "textbox", value: "demo123" },
    { target: "#check", name: "Remember", type: "checkbox", value: "true" },
    { target: "#radio", name: "Choice", type: "radio", value: "true" },
    { target: "#choice", name: "Light", type: "combobox", value: "Shady" },
    { target: "#range", name: "Amount", type: "slider", value: "25" },
  ];
  expect(bridge({ op: "fill", fields }).error).toBeUndefined();
  expect([...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")].map(el => el.value)).toEqual(["demo", "demo123", "on", "on", "shade", "25"]);
  expect(document.querySelector<HTMLInputElement>("#check")!.checked).toBe(true);
  expect(document.querySelector<HTMLInputElement>("#radio")!.checked).toBe(true);
  expect(input).toHaveBeenCalledTimes(6); expect(change).toHaveBeenCalledTimes(6);
  const nodes = bridge({ op: "snapshot" }).result.nodes;
  expect(nodes[1].value).toBeUndefined();
  expect(bridge({ op: "fill", fields: [{ ...fields[0], target: nodes[0].ref, value: "updated" }] }).error).toBeUndefined();
  expect(document.querySelector<HTMLInputElement>("#user")!.value).toBe("updated");
});
it("validates every field before filling and rejects disabled/read-only/non-text inputs", () => {
  document.body.innerHTML = '<input id="first" value="unchanged"/><fieldset disabled><input id="disabled"/></fieldset><input id="readonly" readonly/><input id="file" type="file"/><button id="button">Save</button>';
  const first = { target: "#first", type: "textbox", value: "changed" };
  for (const target of ["#disabled", "#readonly", "#file", "#button"]) {
    expect(bridge({ op: "fill", fields: [first, { ...first, target }] }).error).toBeDefined();
    expect(document.querySelector<HTMLInputElement>("#first")!.value).toBe("unchanged");
    expect(bridge({ op: "type", ref: target, text: "bad" }).error).toBeDefined();
  }
  expect(bridge({ op: "fill", fields: [{ ...first, type: "unknown" }] }).error).toContain("Unsupported field");
});

const pageEvaluate = async (fn: unknown, url = location.href, marker: string | null = null) => JSON.parse(await window.eval(`(${evaluateSource})`)(() => fn, url, marker));
it("awaits page evaluation and returns JSON, undefined and errors safely", async () => {
  expect(await pageEvaluate(async () => ({ title: document.title, count: 3 }))).toEqual({ result: { title: document.title, count: 3 } });
  expect(await pageEvaluate(() => undefined)).toEqual({ result: null });
  expect(await pageEvaluate(async () => { throw new Error("rejected"); })).toEqual({ error: "rejected" });
  expect((await pageEvaluate(42)).error).toContain("Expected a JavaScript function");
  expect((await pageEvaluate(() => document.body)).error).toContain("DOM nodes");
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  expect((await pageEvaluate(() => cyclic)).error).toBeDefined();
  expect((await pageEvaluate(() => BigInt(1))).error).toBeDefined();
  expect((await pageEvaluate(() => "界".repeat(70000))).error).toContain("200 KB");
});
it("carries a private snapshot target into evaluation without leaving DOM markers", async () => {
  const ref = refOf("textbox");
  const marker = "data-nucode-evaluate-12345678-1234-1234-1234-123456789abc";
  expect(bridge({ op: "mark", ref, marker }).error).toBeUndefined();
  expect(await pageEvaluate((el: HTMLInputElement) => { expect(el.hasAttribute(marker)).toBe(false); return el.id; }, location.href, marker)).toEqual({ result: "name" });
  expect(document.querySelector(`[${marker}]`)).toBeNull();
  bridge({ op: "mark", ref, marker });
  expect((await pageEvaluate(() => null, "https://different.example", marker)).error).toContain("Page navigated");
  bridge({ op: "unmark", marker }); expect(document.querySelector(`[${marker}]`)).toBeNull();
  expect(bridge({ op: "mark", ref, marker: "bad]" }).error).toContain("Invalid evaluation marker");
});

it("submits a filled login form and refuses evaluation after a URL change", async () => {
  document.body.innerHTML = '<form><input id="user"/><input id="pass" type="password"/><button>Log in</button></form>';
  const submit = vi.fn((e: Event) => e.preventDefault()); document.querySelector("form")!.addEventListener("submit", submit);
  expect(bridge({ op: "type", ref: "#user", text: "demo" }).error).toBeUndefined();
  expect(bridge({ op: "type", ref: "#pass", text: "demo123", submit: true })).toEqual({ result: { performed: true } });
  expect(submit).toHaveBeenCalledOnce();
  const createFunction = vi.fn(() => () => "unexpected");
  const result = JSON.parse(await window.eval(`(${evaluateSource})`)(createFunction, "https://elsewhere.example", null));
  expect(result.error).toContain("Page navigated"); expect(createFunction).not.toHaveBeenCalled();
});

it("refuses selectors and form writes if the page changed after origin validation", () => {
  const fields = [{ target: "#name", type: "textbox", value: "wrong page" }];
  expect(bridge({ op: "fill", fields, expectedUrl: "https://previous.example" }).error).toContain("Page navigated before action");
  expect(bridge({ op: "type", ref: "#name", text: "wrong page", expectedUrl: "https://previous.example" }).error).toContain("Page navigated before action");
  expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("");
  expect(bridge({ op: "fill", fields, expectedUrl: location.href }).error).toBeUndefined();
  expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("wrong page");
});
it("reports checked, selected and expanded state instead of raw values", () => {
  document.body.innerHTML = '<input type="checkbox" checked/><input type="radio"/><select><option value="a">Alpha</option><option value="b" selected>Beta</option></select><button aria-expanded="false">Menu</button><div role="switch" aria-checked="true">Dark</div>';
  const [box, radio, select, menu, toggle] = bridge({ op: "snapshot" }).result.nodes;
  expect(box).toMatchObject({ checked: true }); expect(box.value).toBeUndefined();
  expect(radio).toMatchObject({ checked: false });
  expect(select.value).toBe("Beta");
  expect(menu).toMatchObject({ expanded: false });
  expect(toggle).toMatchObject({ checked: true });
});
