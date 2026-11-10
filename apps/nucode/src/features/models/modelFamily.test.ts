import { describe, expect, it } from "vitest";
import { modelFamily } from "./modelFamily";

describe("modelFamily", () => {
  it.each([
    [{ name: "Claude Opus 5.5" }, "claude"],
    [{ id: "anthropic/claude-sonnet-5-5" }, "claude"],
    [{ name: "GPT 6.1 Sol (Account 2)" }, "openai"],
    [{ id: "gpt-5-codex" }, "openai"],
    [{ name: "Gemini 3.8 Flash" }, "gemini"],
    [{ id: "qwen3-coder-plus" }, "qwen"],
    [{ name: "Qwen2.5 72B" }, "qwen"],
    [{ id: "glm-5.3-flash" }, "glm"],
    [{ name: "Custom", provider: "zhipu" }, "glm"],
  ] as const)("identifies %o as %s", (model, family) => {
    expect(modelFamily(model)).toBe(family);
  });

  it("prefers the model over the provider and falls back to null", () => {
    expect(modelFamily({ name: "Gemini 3.8 Flash", provider: "openai-compatible" })).toBe("gemini");
    expect(modelFamily({ name: "Local llama", provider: "ollama" })).toBeNull();
    expect(modelFamily(null)).toBeNull();
  });
});
