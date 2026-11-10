// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useThreadOrder } from "./useThreadOrder";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it("loads and saves per project, retaining unloaded ids and bumping the version", () => {
  localStorage.setItem("nucode.threadOrder.v1", JSON.stringify({ a: ["unloaded-a", "two", "unloaded-b"], b: ["other"] }));
  const { result, unmount } = renderHook(useThreadOrder);
  expect(result.current.getOrder("a")).toEqual(["unloaded-a", "two", "unloaded-b"]);
  act(() => result.current.saveOrder("a", ["two", "one"]));
  expect(result.current.version).toBe(1);
  expect(result.current.getOrder("a")).toEqual(["two", "one", "unloaded-a", "unloaded-b"]);
  act(() => result.current.saveOrder("a", ["two", "one"]));
  expect(result.current.version).toBe(2);
  unmount();
  const reloaded = renderHook(useThreadOrder).result;
  expect(reloaded.current.getOrder("a")).toEqual(["two", "one", "unloaded-a", "unloaded-b"]);
  expect(reloaded.current.getOrder("b")).toEqual(["other"]);
  expect(reloaded.current.getOrder("missing")).toEqual([]);
});

it("keeps working in memory when storage reads and writes throw", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  const { result } = renderHook(useThreadOrder);
  act(() => result.current.saveOrder("a", ["two", "one"]));
  expect(result.current.getOrder("a")).toEqual(["two", "one"]);
  expect(result.current.version).toBe(1);
});

it.each(['null', '[]', '{"a":false,"b":[1],"c":["valid"]}', 'invalid'])
  ("validates stored orders: %s", value => {
    localStorage.setItem("nucode.threadOrder.v1", value);
    const { result } = renderHook(useThreadOrder);
    expect(result.current.getOrder("a")).toEqual([]);
    expect(result.current.getOrder("b")).toEqual([]);
    expect(result.current.getOrder("__proto__")).toEqual([]);
  });
