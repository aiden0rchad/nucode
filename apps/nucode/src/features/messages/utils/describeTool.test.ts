import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import { describeTool, summarizeToolGroup, toolStatusTone } from "./messageRenderUtils";

type Tool = Extract<ConversationItem, { kind: "tool" }>;
const tool = (patch: Partial<Tool>): Tool => ({ id: Math.random().toString(36), kind: "tool", toolType: "mcpToolCall", title: "", detail: "", status: "completed", ...patch } as Tool);

describe("describeTool", () => {
  it.each([
    ["xd://mcp__nucode_browser_browser_snapshot", "browser snapshot tool"],
    ["xd://mcp__codegraph_explore", "codegraph explore tool"],
  ])("labels the schema lookup %s", (path, target) => {
    expect(describeTool(tool({ title: "Tool: read", detail: JSON.stringify({ path }) }))).toEqual({ verb: "Looked up", target, category: "lookup" });
  });
  it("uses agent names when recovered delegation records lack receiver metadata", () => {
    expect(describeTool(tool({ toolType: "collabToolCall", title: "Collab: spawnAgent", agentsTree: [{ id: "first", agent: "Researcher", status: "completed", children: [] }, { id: "second", agent: "Reviewer", status: "completed", children: [] }] })).target).toBe("Researcher +1");
    expect(describeTool(tool({ toolType: "collabToolCall", title: "Collab: spawnAgent" })).target).toBe("agent");
  });
  it("shows a stopped delegation neutrally without hiding an actual child failure", () => {
    const item = tool({ toolType: "collabToolCall", title: "collab: spawnAgent", status: "failed", agentsTree: [{ id: "colonel", agent: "colonel", status: "aborted", children: [{ id: "major", agent: "major", status: "completed", children: [] }] }] });
    expect(describeTool(item).verb).toBe("Stopped");
    expect(toolStatusTone(item, false)).toBe("unknown");
    expect(summarizeToolGroup([item])).toBe("1 sub-agent call · 1 stopped");
    item.agentsTree![0].children![0].status = "failed";
    expect(describeTool(item).verb).toBe("Spawn failed");
    expect(toolStatusTone(item, false)).toBe("failed");
    expect(summarizeToolGroup([item])).toBe("1 sub-agent call · 1 failed");
  });
  it("gives every call a short verb and target instead of raw tool names", () => {
    const cases: Array<[Partial<Tool>, string, string]> = [
      [{ toolType: "commandExecution", title: "Command: /bin/zsh -lc 'node --test'" }, "Ran", "node --test"],
      [{ toolType: "fileChange", changes: [{ path: "/repo/index.html", kind: "add" }] as Tool["changes"] }, "Created", "index.html"],
      [{ toolType: "fileChange", changes: [{ path: "/repo/app.js", kind: "update" }, { path: "/repo/b.js", kind: "update" }] as Tool["changes"] }, "Edited", "app.js +1"],
      [{ toolType: "fileChange" }, "Edited", "files"],
      [{ title: "Tool: Browser / browser_navigate", detail: JSON.stringify({ url: "http://localhost:47410/" }) }, "Opened", "localhost:47410"],
      [{ title: "Tool: Browser / browser_click", detail: JSON.stringify({ element: "Add button", target: "e6" }) }, "Clicked", "Add button"],
      [{ title: "Tool: Browser / browser_click", detail: JSON.stringify({ target: "e46" }) }, "Clicked", ""],
      [{ title: "Tool: Browser / browser_console_messages" }, "Checked console", ""],
      [{ title: "Tool: Browser / browser_scroll", detail: JSON.stringify({ y: 600 }) }, "Scrolled", ""],
      [{ title: "Tool: preview_server", detail: JSON.stringify({ action: "start", label: "Dashboard" }) }, "Started preview", "Dashboard"],
      [{ title: "Tool: preview_server", detail: JSON.stringify({ action: "stop" }) }, "Stopped preview", ""],
      [{ title: "Tool: preview_server", detail: JSON.stringify({ action: "list" }) }, "Checked previews", ""],
      [{ title: "Tool: read", detail: JSON.stringify({ path: "src/streak.js:1-60" }) }, "Read", "streak.js"],
      [{ title: "Tool: CodeGraph / codegraph_explore", detail: JSON.stringify({ query: "streak logic" }) }, "Explored code", "streak logic"],
      [{ title: "Tool: grep", detail: JSON.stringify({ pattern: "TODO" }) }, "Searched", "TODO"],
      [{ title: "Tool: Some Server / make_widget" }, "Used", "make widget"],
    ];
    for (const [patch, verb, target] of cases) expect(describeTool(tool(patch))).toMatchObject({ verb, target });
  });
});

describe("summarizeToolGroup", () => {
  it("excludes schema lookups, including their failures, but counts real file reads", () => {
    const lookup = tool({ title: "Tool: read", detail: JSON.stringify({ path: "xd://mcp__nucode_browser_browser_snapshot" }), status: "failed" });
    expect(summarizeToolGroup([lookup, ...["browser_navigate", "browser_snapshot", "browser_click"].map(title => tool({ title: `Tool: ${title}` }))])).toBe("3 browser actions");
    expect(summarizeToolGroup([lookup])).toBe("");
    expect(summarizeToolGroup([tool({ title: "Tool: read", detail: JSON.stringify({ path: "src/app.ts" }) })])).toBe("Read 1 file");
  });
  it("counts code-mode tools as commands", () => {
    expect(describeTool(tool({ title: "Tool: exec" }))).toMatchObject({ verb: "Ran code", category: "command" });
    expect(summarizeToolGroup([tool({ title: "Tool: exec" }), tool({ title: "Tool: cua_repl / js" })])).toBe("Ran 2 commands");
  });
  it("names uncategorised tools when there are one or two kinds and counts them otherwise", () => {
    const other = (name: string) => tool({ title: `Tool: ${name}` });
    expect(summarizeToolGroup([other("context_compaction"), other("context_compaction")])).toBe("Used context compaction ×2");
    expect(summarizeToolGroup([other("context_compaction"), other("make_report")])).toBe("Used context compaction, make report");
    expect(summarizeToolGroup([other("alpha_one"), other("beta_two"), other("gamma_three")])).toBe("3 other tool calls");
  });
  it("summarizes categories and failures in one line", () => {
    const items = [
      tool({ title: "Tool: read", detail: JSON.stringify({ path: "a.js" }) }),
      tool({ title: "Tool: read", detail: JSON.stringify({ path: "b.js" }) }),
      tool({ toolType: "fileChange", changes: [{ path: "a.js", kind: "update" }] as Tool["changes"] }),
      tool({ toolType: "commandExecution", title: "Command: node --test", status: "failed" }),
      tool({ title: "Tool: Browser / browser_click" }),
      tool({ title: "Tool: Browser / browser_type" }),
    ];
    expect(summarizeToolGroup(items)).toBe("Read 2 files · Edited 1 file · Ran 1 command · 2 browser actions · 1 failed");
  });
});
