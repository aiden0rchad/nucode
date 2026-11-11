import { describe, expect, it, vi } from "vitest";
import type { ProviderEntry } from "@/types";
import { formatK, parseAutoCompact, parseContextSize, runContextCommand, type ContextCommandEnv } from "./contextCommands";

const provider = { id: "provider-a", name: "A", kind: "openai-compatible", auth: { type: "none" }, enabled: true, models: [{ id: "model-b", enabled: true, contextWindow: 272000 }, { id: "model-c", enabled: true }] } as unknown as ProviderEntry;
const env = (overrides: Partial<ContextCommandEnv> = {}): ContextCommandEnv => ({ providers: [provider], autoCompact: undefined, model: { providerId: "provider-a", modelId: "model-b", name: "Model B" }, save: vi.fn().mockResolvedValue(undefined), ...overrides });

describe("context commands", () => {
  it.each([["200000", 200000], ["200k", 200000], ["200K", 200000], ["1m", 1_000_000], ["1.5M", 1_500_000], ["8k", 8000]])("parses %s", (text, size) => expect(parseContextSize(text)).toBe(size));
  it.each(["", "abc", "7k", "11m", "-5k", "1.5.2k", "400 tokens"])("rejects %s", text => expect(parseContextSize(text)).toBeNull());
  it.each([[33000, "33k"], [999, "999"], [309900, "309.9k"], [1_000_000, "1m"], [1_500_000, "1.5m"], [null, "—"]])("formats %s", (value, text) => expect(formatK(value)).toBe(text));
  it("parses auto-compact arguments", () => {
    expect(parseAutoCompact("")).toEqual({ type: "report" });
    expect(parseAutoCompact("OFF")).toEqual({ type: "off" });
    expect(parseAutoCompact("on")).toEqual({ type: "on" });
    expect(parseAutoCompact("80%")).toEqual({ type: "percent", percent: 80 });
    for (const bad of ["49", "96", "x", "80.5"]) expect(parseAutoCompact(bad)).toEqual({ type: "invalid" });
  });
  it("sets the model's context size and reports the previous one", async () => {
    const e = env();
    expect(await runContextCommand("/context-size 400k", e)).toBe("Context size for Model B set to 400k (was 272k). Applies from the next turn.");
    const saved = (e.save as ReturnType<typeof vi.fn>).mock.calls[0][0].providers[0].models;
    expect(saved[0].contextWindow).toBe(400000);
    expect(saved[1].contextWindow).toBeUndefined();
  });
  it("clears the size with default and rejects bad input without saving", async () => {
    const e = env();
    expect(await runContextCommand("/context-size default", e)).toContain("reset to the default (was 272k)");
    expect((e.save as ReturnType<typeof vi.fn>).mock.calls[0][0].providers[0].models[0].contextWindow).toBeNull();
    const bad = env();
    expect(await runContextCommand("/context-size lots", bad)).toMatch(/^Usage: \/context-size/);
    expect(bad.save).not.toHaveBeenCalled();
  });
  it("sets, disables and reports auto-compact", async () => {
    const e = env();
    expect(await runContextCommand("/autocompact 80", e)).toBe("Auto-compact at 80% of the context window. Applies from the next turn.");
    expect(e.save).toHaveBeenCalledWith({ autoCompact: { enabled: true, percent: 80 } });
    expect(await runContextCommand("/autocompact off", env({ autoCompact: { enabled: true, percent: 80 } }))).toBe("Auto-compact is off. Applies from the next turn.");
    expect(await runContextCommand("/autocompact", env({ autoCompact: { enabled: false } }))).toBe("Auto-compact is off.");
    expect(await runContextCommand("/autocompact", env({ autoCompact: { enabled: true, percent: 70 } }))).toBe("Auto-compact at 70% of the context window.");
    expect(await runContextCommand("/autocompact 20", env())).toMatch(/^Usage: \/autocompact/);
  });
});
