import { describe, expect, it, vi } from "vitest";
import type { ProviderEntry } from "@/types";
import { formatK, parseAutoCompact, parseContextSize, parseTokens, runContextCommand, type ContextCommandEnv } from "./contextCommands";

const provider = { id: "provider-a", name: "A", kind: "openai-compatible", auth: { type: "none" }, enabled: true, models: [{ id: "model-b", enabled: true, contextWindow: 300000 }, { id: "model-c", enabled: true }] } as unknown as ProviderEntry;
const withModel = (patch: object) => ({ ...provider, models: [{ ...provider.models[0], ...patch }, provider.models[1]] }) as ProviderEntry;
const env = (overrides: Partial<ContextCommandEnv> = {}): ContextCommandEnv => ({ providers: [provider], autoCompact: undefined, model: { providerId: "provider-a", modelId: "model-b", name: "Model B" }, save: vi.fn().mockResolvedValue(undefined), ...overrides });
const saved = (e: ContextCommandEnv, call = 0) => (e.save as ReturnType<typeof vi.fn>).mock.calls[call][0];
const next = "Takes effect on your next message; this conversation carries on.";

describe("context commands", () => {
  it.each([["200000", 200000], ["200k", 200000], ["200K", 200000], ["1m", 1_000_000], ["1.5M", 1_500_000], ["8k", 8000], [" 500k ", 500000]])("parses %s", (text, size) => expect(parseContextSize(text)).toBe(size));
  it.each(["", "abc", "7k", "11m", "-5k", "1.5.2k", "400 tokens", "500g", "k"])("rejects %s", text => expect(parseContextSize(text)).toBeNull());
  it.each([["290k", 290000], ["1.25m", 1_250_000], ["2500", 2500]])("parses token count %s", (text, n) => expect(parseTokens(text)).toBe(n));
  it.each([[33000, "33k"], [999, "999"], [309900, "309.9k"], [1_000_000, "1m"], [1_500_000, "1.5m"], [null, "—"]])("formats %s", (value, text) => expect(formatK(value)).toBe(text));

  it("parses auto-compact arguments as token counts", () => {
    expect(parseAutoCompact("")).toEqual({ type: "report" });
    expect(parseAutoCompact("OFF")).toEqual({ type: "off" });
    expect(parseAutoCompact("on")).toEqual({ type: "on" });
    expect(parseAutoCompact("Default")).toEqual({ type: "default" });
    expect(parseAutoCompact("290k")).toEqual({ type: "tokens", tokens: 290000 });
    expect(parseAutoCompact("280K")).toEqual({ type: "tokens", tokens: 280000 });
    expect(parseAutoCompact("1.2m")).toEqual({ type: "tokens", tokens: 1_200_000 });
    for (const bad of ["80%", "80", "999", "x", "-5k", "290 k tokens"]) expect(parseAutoCompact(bad)).toEqual({ type: "invalid" });
  });

  it("sets the model's window with /maxcontext and reports the previous one", async () => {
    const e = env();
    expect(await runContextCommand("/maxcontext 500k", e)).toBe(`Context window for Model B set to 500k (was 300k). ${next}`);
    const models = saved(e).providers[0].models;
    expect(models[0].contextWindow).toBe(500000);
    expect(models[1].contextWindow).toBeUndefined();
  });

  it("keeps /context-size as another name for /maxcontext", async () => {
    const e = env();
    expect(await runContextCommand("/context-size 1m", e)).toContain("set to 1m");
  });

  it("resets the window with default and rejects bad input without saving", async () => {
    const e = env();
    expect(await runContextCommand("/maxcontext default", e)).toContain("reset to the default (128k) (was 300k)");
    expect(saved(e).providers[0].models[0].contextWindow).toBeNull();
    for (const text of ["/maxcontext lots", "/maxcontext", "/maxcontext 2k"]) {
      const bad = env();
      expect(await runContextCommand(text, bad)).toMatch(/^Usage: \/maxcontext/);
      expect(bad.save).not.toHaveBeenCalled();
    }
  });

  it("will not shrink the window to or below the auto-compact point", async () => {
    const e = env({ providers: [withModel({ compactAt: 290000 })] });
    expect(await runContextCommand("/maxcontext 290k", e)).toMatch(/auto-compacts at 290k, so its context window must stay above that/);
    expect(await runContextCommand("/maxcontext default", e)).toMatch(/must stay above that/);
    expect(e.save).not.toHaveBeenCalled();
    expect(await runContextCommand("/maxcontext 291k", e)).toContain("set to 291k");
  });

  it("sets the model's auto-compact point below its window", async () => {
    const e = env();
    expect(await runContextCommand("/autocompact 290k", e)).toBe(`Model B auto-compacts at 290k of its 300k context window. ${next}`);
    expect(saved(e).providers[0].models[0].compactAt).toBe(290000);
    expect(saved(e).autoCompact).toBeUndefined();
  });

  it("rejects a point at or above the window, including the default window", async () => {
    for (const text of ["/autocompact 300k", "/autocompact 500k"]) {
      const e = env();
      expect(await runContextCommand(text, e)).toMatch(/is not below the 300k context window of Model B/);
      expect(e.save).not.toHaveBeenCalled();
    }
    const unset = env({ model: { providerId: "provider-a", modelId: "model-c", name: "Model C" } });
    expect(await runContextCommand("/autocompact 128k", unset)).toMatch(/not below the 128k context window/);
    expect(await runContextCommand("/autocompact 120k", unset)).toContain("auto-compacts at 120k of its 128k");
  });

  it("turns auto-compact back on when a point is set, and clears the point with default", async () => {
    const off = env({ autoCompact: { enabled: false } });
    await runContextCommand("/autocompact 280k", off);
    expect(saved(off).autoCompact).toEqual({ enabled: true });
    const e = env({ providers: [withModel({ compactAt: 290000 })] });
    expect(await runContextCommand("/autocompact default", e)).toContain("default threshold of its 300k");
    expect(saved(e).providers[0].models[0].compactAt).toBeNull();
  });

  it("toggles and reports auto-compact", async () => {
    const e = env({ autoCompact: { enabled: true, percent: 80 } });
    expect(await runContextCommand("/autocompact off", e)).toBe(`Auto-compact is off. ${next}`);
    expect(saved(e)).toEqual({ autoCompact: { enabled: false, percent: 80 } });
    expect(await runContextCommand("/autocompact", env({ autoCompact: { enabled: false } }))).toBe("Auto-compact is off.");
    expect(await runContextCommand("/autocompact", env({ autoCompact: { enabled: true, percent: 70 } }))).toBe("Auto-compact at 70% of the context window.");
    expect(await runContextCommand("/autocompact", env({ providers: [withModel({ compactAt: 290000 })] }))).toBe("Model B auto-compacts at 290k of its 300k context window.");
    expect(await runContextCommand("/autocompact 80", env())).toMatch(/^Usage: \/autocompact/);
  });

  it("needs a model in the providers for per-model settings", async () => {
    expect(await runContextCommand("/autocompact 100k", env({ model: null }))).toBe("Select a model first.");
    expect(await runContextCommand("/maxcontext 100k", env({ model: { providerId: "x", modelId: "y", name: "Y" } }))).toMatch(/not in your providers/);
  });
});
