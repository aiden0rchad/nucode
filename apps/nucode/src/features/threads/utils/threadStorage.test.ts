// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  STORAGE_KEY_PINNED_PROJECTS,
  STORAGE_KEY_THREAD_SECTIONS,
  loadPinnedProjects,
  loadThreadSections,
  makeThreadSectionKey,
  savePinnedProjects,
  saveThreadSections,
} from "./threadStorage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("project pins storage", () => {
  it("round-trips pin timestamps", () => {
    savePinnedProjects({ a: 1, b: 2 });
    expect(loadPinnedProjects()).toEqual({ a: 1, b: 2 });
  });

  it("ignores malformed or non-numeric data", () => {
    window.localStorage.setItem(STORAGE_KEY_PINNED_PROJECTS, "{nope");
    expect(loadPinnedProjects()).toEqual({});
    window.localStorage.setItem(STORAGE_KEY_PINNED_PROJECTS, JSON.stringify(["a"]));
    expect(loadPinnedProjects()).toEqual({});
    window.localStorage.setItem(
      STORAGE_KEY_PINNED_PROJECTS,
      JSON.stringify({ a: 1, b: "x" }),
    );
    expect(loadPinnedProjects()).toEqual({ a: 1 });
  });
});

describe("thread sections storage", () => {
  it("round-trips section ids by workspace and thread", () => {
    const key = makeThreadSectionKey("ws", "t1");
    saveThreadSections({ [key]: "group-1" });
    expect(loadThreadSections()).toEqual({ "ws:t1": "group-1" });
  });

  it("ignores malformed or non-string data", () => {
    window.localStorage.setItem(STORAGE_KEY_THREAD_SECTIONS, "null");
    expect(loadThreadSections()).toEqual({});
    window.localStorage.setItem(
      STORAGE_KEY_THREAD_SECTIONS,
      JSON.stringify({ "ws:t1": "g", "ws:t2": 4 }),
    );
    expect(loadThreadSections()).toEqual({ "ws:t1": "g" });
  });
});
