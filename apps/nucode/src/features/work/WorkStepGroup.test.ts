import { describe, expect, it } from "vitest";
import type { ConversationItem } from "@/types";
import { groupWorkSteps, shortWorkSummary, summarizeWorkSteps } from "./WorkStepGroup";

const message = (id: string): ConversationItem => ({ id, kind: "message", role: "assistant", text: id } as ConversationItem);
const thinking = (id: string): ConversationItem => ({ id, kind: "reasoning", summary: "", content: "" });

describe("groupWorkSteps", () => {
  it("joins consecutive steps and keeps messages on their own", () => {
    const items = [message("a"), thinking("t1"), thinking("t2"), message("b"), thinking("t3")];
    expect(groupWorkSteps(items).map(block => block.map(item => item.id))).toEqual([["a"], ["t1", "t2"], ["b"], ["t3"]]);
  });

  it("summarizes reasoning runs in words", () => {
    expect(summarizeWorkSteps([thinking("t1"), thinking("t2")])).toBe("Thought twice");
    expect(summarizeWorkSteps([thinking("t1")])).toBe("Thought once");
  });
  it("excludes schema lookups from the tally and shortened step count", () => {
    const tool = (title: string, detail = ""): ConversationItem => ({ id: title, kind: "tool", toolType: "mcpToolCall", title: `Tool: ${title}`, detail, status: "completed" });
    const lookup = tool("read", JSON.stringify({ path: "xd://mcp__nucode_browser_browser_snapshot" }));
    const browser = ["browser_navigate", "browser_snapshot", "browser_click"].map(title => tool(title));
    expect(summarizeWorkSteps([lookup, ...browser])).toBe("3 browser actions");
    expect(summarizeWorkSteps([lookup])).toBe("");
    expect(shortWorkSummary([lookup, ...browser, tool("read", JSON.stringify({ path: "app.ts" })), thinking("t")])).toBe("5 steps · Read 1 file · 3 browser actions +1 more");
  });
});
