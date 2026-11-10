import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import { buildToolSummary, collapseChecklistPlans, statusToneFromText, stripTaskList } from "./messageRenderUtils";

function makeToolItem(
  overrides: Partial<Extract<ConversationItem, { kind: "tool" }>>,
): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id: "tool-1",
    kind: "tool",
    toolType: "webSearch",
    title: "Web search",
    detail: "codex monitor",
    status: "completed",
    output: "",
    ...overrides,
  };
}

describe("messageRenderUtils", () => {
  it("renders web search as searching while in progress", () => {
    const summary = buildToolSummary(makeToolItem({ status: "inProgress" }), "");
    expect(summary.label).toBe("searching");
    expect(summary.value).toBe("codex monitor");
  });

  it("renders mcp search calls as searching while in progress", () => {
    const summary = buildToolSummary(
      makeToolItem({
        toolType: "mcpToolCall",
        title: "Tool: web / search_query",
        detail: '{\n  "query": "codex monitor"\n}',
        status: "inProgress",
      }),
      "",
    );
    expect(summary.label).toBe("searching");
    expect(summary.value).toBe("codex monitor");
  });

  it("shows an mcp tool's output only when it failed", () => {
    const item = makeToolItem({
      toolType: "mcpToolCall",
      title: "Tool: nucode-browser / browser_evaluate",
      detail: '{\n  "function": "() => document.querySelector(\'main\').innerText"\n}',
      output: "TypeError: null is not an object",
    });
    expect(buildToolSummary({ ...item, status: "failed" }, "").output).toBe("TypeError: null is not an object");
    expect(buildToolSummary(item, "").output).toBe("");
  });

  it("classifies camelCase inProgress as processing", () => {
    expect(statusToneFromText("inProgress")).toBe("processing");
  });

  it("renders collab tool calls with nickname and role", () => {
    const summary = buildToolSummary(
      makeToolItem({
        toolType: "collabToolCall",
        title: "Collab: wait",
        detail: "From thread-parent → thread-child",
        status: "completed",
        output: "Robie [explorer]: completed",
        collabReceivers: [
          {
            threadId: "thread-child",
            nickname: "Robie",
            role: "explorer",
          },
        ],
      }),
      "",
    );
    expect(summary.label).toBe("waited for");
    expect(summary.value).toBe("Robie [explorer]");
    expect(summary.output).toContain("Robie [explorer]: completed");
  });

  it.each([
    { name: "nickname", nickname: " Scout ", role: "reviewer", expected: "Scout" },
    { name: "role", role: " reviewer ", expected: "reviewer" },
    { name: "no metadata", expected: "Sub-agent" },
  ])("labels one synthetic receiver using $name", ({ expected, nickname, role }) => {
    const summary = buildToolSummary(makeToolItem({
      toolType: "collabToolCall",
      title: "Collab: spawnAgent",
      collabReceiver: { threadId: "tool-1:agent:0", nickname, role },
    }), "");
    expect(summary.value).toBe(expected);
  });

  it("labels multiple synthetic receivers from the matching agent tree node", () => {
    const summary = buildToolSummary(makeToolItem({
      toolType: "collabToolCall",
      title: "Collab: spawnAgent",
      status: "failed",
      collabReceivers: [{ threadId: "tool-1:agent:0" }, { threadId: "tool-1:agent:1" }],
      agentsTree: [
        { id: "tool-1:agent:1", agent: "writer", status: "failed", children: [] },
        { id: "tool-1:agent:0", agent: "scout", status: "failed", children: [] },
      ],
    }), "");
    expect(summary.value).toBe("scout +1");
    expect(summary.label).toBe("spawn failed");
  });

  it.each([
    { role: undefined, expected: "thread-child" },
    { role: "reviewer", expected: "thread-child [reviewer]" },
  ])("preserves real receiver identifiers ($expected)", ({ role, expected }) => {
    const summary = buildToolSummary(makeToolItem({
      toolType: "collabToolCall",
      title: "Collab: spawnAgent",
      collabReceivers: [{ threadId: "thread-child", role }],
    }), "");
    expect(summary.value).toBe(expected);
    expect(summary.label).toBe("spawned");
  });

  it("keeps the in-progress spawn label", () => {
    expect(buildToolSummary(makeToolItem({
      toolType: "collabToolCall", title: "Collab: spawnAgent", status: "inProgress",
    }), "").label).toBe("spawning");
  });
});

describe("collapseChecklistPlans", () => {
  const first = "- [x] Read inputs\n- [ ] Add the button\n  with a label";
  const last = "- [x] Read inputs\n- [x] Add the button\n\nAll done.";
  const items: ConversationItem[] = [
    { id: "u", kind: "message", role: "user", text: "Go" },
    { id: "m1", kind: "message", role: "assistant", text: first },
    { id: "p1", kind: "tool", toolType: "plan", title: "Plan", detail: "", output: first },
    { id: "m2", kind: "message", role: "assistant", text: last },
    { id: "p2", kind: "tool", toolType: "plan", title: "Plan", detail: "", output: last },
  ];

  it("keeps only the latest checklist inline and folds earlier ones into their plan rows", () => {
    const { items: result, checklistPlanIds } = collapseChecklistPlans(items);
    expect(result.map((item) => item.id)).toEqual(["u", "p1", "m2"]);
    expect(checklistPlanIds).toEqual(new Set(["p1", "p2"]));
  });

  it("keeps the prose of a superseded checklist message", () => {
    expect(stripTaskList("Plan:\n- [ ] One\n  more\n- [x] Two\n\nStarting now.")).toBe("Plan:\n\nStarting now.");
  });

  it("leaves threads without checklist plans alone", () => {
    const plain: ConversationItem[] = [{ id: "p", kind: "tool", toolType: "plan", title: "Plan", detail: "", output: "1. Do it" }];
    expect(collapseChecklistPlans(plain).items).toBe(plain);
  });
});
