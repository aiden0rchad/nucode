import { describe, expect, it } from "vitest";
import { clampThreadName } from "./threadNaming";

describe("clampThreadName", () => {
  it("keeps names up to 80 characters whole", () => {
    expect(clampThreadName("Use your Computer Use tool on Calculator only")).toBe("Use your Computer Use tool on Calculator only");
  });
  it("cuts long names at a word boundary", () => {
    const name = clampThreadName("Write a 900-word story about a lighthouse keeper who retires after forty years and learns to garden");
    expect(name?.endsWith("…")).toBe(true);
    expect(name?.length).toBeLessThanOrEqual(81);
    expect(name).not.toMatch(/\S…$/.source.length ? / [a-z]{1,2}…$/ : /x/);
    expect(name?.slice(0, -1).endsWith(" ")).toBe(false);
  });
});
