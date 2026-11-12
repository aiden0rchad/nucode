/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextReport } from "@/types";
import { setupPointerEvents } from "@/test/pointerEvents";
import { CodeSessionRail, type CodeSessionRailProps } from "./CodeSessionRail";
const panel = vi.hoisted(() => ({ openTool: vi.fn(), openPage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/features/panels/SidePanel", () => ({ useSidePanel: () => panel }));
vi.mock("@/features/design-system/components/modal/ModalShell", () => ({ ModalShell: ({ children }: { children: React.ReactNode }) => <div role="dialog" aria-label="New environment">{children}</div> }));
setupPointerEvents();

const task = { id: "task", workspaceId: "w", threadId: "t", command: "npm run dev", label: "Dev server", cwd: "/workspace", pid: 1, status: "running" as const, startedAt: Date.now() - 30000, endedAt: null, exitCode: null, output: "", outputTruncated: false, urls: ["http://localhost:3000"] };
function props(): CodeSessionRailProps {
  const workspace = { id: "w", name: "Project", path: "/workspace", connected: true, settings: { sidebarCollapsed: false } };
  return { workspace, workspaces: [workspace], branch: "main", branches: [{ name: "main", lastCommit: 0 }], canCheckoutBranch: true, onCheckoutBranch: vi.fn(), onSelectWorkspace: vi.fn(), profiles: [], engine: "pi", modelId: "model", onSaveEnvironment: vi.fn().mockResolvedValue(undefined), onSelectEnvironment: vi.fn(), onDeleteEnvironment: vi.fn().mockResolvedValue(undefined), remote: { mode: "local", host: "localhost:4732" }, usage: null, protocol: "pi-rpc", skills: [], skillsAvailable: false, memoryFiles: ["AGENTS.md"], connectors: [{ id: "browser", name: "Browser", enabled: true }], connectorError: null, connectorsLoading: false, outputs: ["reports/result.md"], onOpenFile: vi.fn().mockReturnValue(true), git: { enabled: true, files: 2, additions: 10, deletions: 3, error: null }, tasks: { tasks: [task], servers: [{ id: "server", taskId: "task", url: "http://localhost:3000", title: "Dev server", status: "running", startedAt: task.startedAt }], error: "", busy: false, canStart: true, start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined), restart: vi.fn(), clearFinished: vi.fn(), refresh: vi.fn() }, tasksEnabled: true, browserEnabled: true, onOpenSettings: vi.fn(), onEditLaunchScripts: vi.fn() };
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);
describe("Code session rail", () => {
  it("shows context usage once, in the Context section, with no header row above the sections", () => {
    const last = { totalTokens: 420, inputTokens: 420, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
    render(<CodeSessionRail {...props()} usage={{ last, total: { ...last, totalTokens: 9000 }, modelContextWindow: 1000 }} />);
    expect(document.querySelector(".code-session-rail > header")).toBeNull();
    expect(screen.queryByRole("meter", { name: "Session context usage" })).toBeNull();
    expect(screen.getAllByText("42%")).toHaveLength(1);
  });
  it("persists card collapse and keyboard reorder", () => {
    const data = props(); const view = render(<CodeSessionRail {...data} />);
    fireEvent.click(screen.getByRole("button", { name: "Environment" }));
    const handle = screen.getByRole("button", { name: "Reorder Context" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(document.activeElement).toBe(handle);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    view.unmount();
    render(<CodeSessionRail {...data} />);
    expect(document.querySelector(".code-session-card-toggle")?.textContent).toBe("Context");
    expect(screen.getByRole("button", { name: "Environment" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Connectors (1)" })).toBeTruthy();
  });
  it("opens actual file/changes/browser panes and keeps stop separate", () => {
    const data = props(); render(<CodeSessionRail {...data} />);
    fireEvent.click(screen.getByRole("button", { name: "result.md" }));
    expect(data.onOpenFile).toHaveBeenCalledWith("reports/result.md");
    expect(panel.openTool).toHaveBeenLastCalledWith("files");
    fireEvent.click(screen.getByRole("button", { name: "Commit…" }));
    expect(panel.openTool).toHaveBeenLastCalledWith("git");
    fireEvent.click(screen.getByRole("button", { name: "Open server Dev server" }));
    expect(panel.openPage).toHaveBeenCalledWith("http://localhost:3000");
    expect(data.tasks.stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop server Dev server" }));
    expect(data.tasks.stop).toHaveBeenCalledWith("task");
  });
  it.each(["before", "after"] as const)("reorders cards %s the target only from the grip and keeps keyboard controls", position => {
    render(<CodeSessionRail {...props()} />);
    const source = screen.getByRole("region", { name: "Changes (2)" });
    const target = screen.getByRole("region", { name: "Environment" });
    const grip = screen.getByRole("button", { name: "Reorder Changes" });
    const clientY = position === "before" ? 125 : 175;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ left: 0, right: 200, width: 200, top: 100, bottom: 200, height: 100 } as DOMRect);
    vi.mocked(document.elementFromPoint).mockReturnValue(target.querySelector("span"));
    for (const element of [source, screen.getByRole("button", { name: "Changes (2)" })]) {
      fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY });
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY });
      expect(source.hasAttribute("data-dragging")).toBe(false);
      expect(JSON.parse(localStorage.getItem("nucode.code.sessionRail")!).order[0]).toBe("Environment");
    }
    fireEvent.pointerDown(grip.querySelector("svg")!, { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY });
    expect(source.getAttribute("data-dragging")).toBe("true");
    expect(grip.hasAttribute("draggable")).toBe(false);
    expect(target.getAttribute("data-drop-edge")).toBe(position);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY });
    fireEvent.click(target.querySelector("button")!);
    expect(screen.getByRole("button", { name: "Environment" }).getAttribute("aria-expanded")).toBe("true");
    expect(Array.from(document.querySelectorAll(".code-session-card-toggle")).slice(0, 2).map(el => el.textContent))
      .toEqual(position === "before" ? ["Changes", "Environment"] : ["Environment", "Changes"]);
    const order = () => JSON.parse(localStorage.getItem("nucode.code.sessionRail")!).order;
    expect(order().slice(0, 2)).toEqual(position === "before" ? ["Changes", "Environment"] : ["Environment", "Changes"]);
    fireEvent.keyDown(grip, { key: position === "before" ? "ArrowDown" : "ArrowUp" });
    expect(order().slice(0, 2)).toEqual(position === "before" ? ["Environment", "Changes"] : ["Changes", "Environment"]);
  });
  it("opens connector configuration from a connector disclosure", () => {
    const data = props(); render(<CodeSessionRail {...data} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure Browser" }));
    expect(data.onOpenSettings).toHaveBeenCalledWith("connectors");
  });
  it("keeps unavailable usage honest and cleanup available when Terminal is off", () => {
    render(<CodeSessionRail {...props()} tasksEnabled={false} />);
    expect(screen.getByText("Usage not reported yet")).toBeTruthy();
    expect(screen.getByText("Skill inventory not reported")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop server Dev server" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start a background task" })).toBeNull();
    expect(screen.getByText("Enable Terminal to start tasks.")).toBeTruthy();
  });
  it("saves a named folder profile and leaves the form open on failure", async () => {
    const data = props(); vi.mocked(data.onSaveEnvironment).mockRejectedValueOnce(new Error("Disk full"));
    render(<CodeSessionRail {...data} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as profile" }));
    expect(screen.getByLabelText("Name")).toBe(document.activeElement);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My setup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Disk full"));
    expect(data.onSaveEnvironment).toHaveBeenCalledWith("My setup", ["w"]);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("shows failed process actions instead of unhandled rejections", async () => {
    const data = props(); vi.mocked(data.tasks.stop).mockRejectedValueOnce(new Error("Already exited"));
    render(<CodeSessionRail {...data} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop server Dev server" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Already exited"));
  });
});

it("keeps empty sections compact, opens new output, and remembers explicit disclosure choices", () => {
  const data = props();
  const view = render(<CodeSessionRail {...data} outputs={[]} />);
  expect(screen.queryByRole("button", { name: /^Outputs/ })).toBeNull();
  expect(document.querySelector(".code-session-empty-summary")?.textContent).toContain("outputs");
  view.rerender(<CodeSessionRail {...data} />);
  expect(screen.getByRole("button", { name: "result.md" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Outputs (1)" }));
  view.unmount(); render(<CodeSessionRail {...data} />);
  expect(screen.queryByRole("button", { name: "result.md" })).toBeNull();
  describe("context report", () => {
    const report: ContextReport = { window: 500000, used: 309900, reserve: 33000, autoCompact: true, rows: [
      { id: "messages", tokens: 238700 }, { id: "mcpTools", tokens: 24400 }, { id: "systemTools", tokens: 21200 }, { id: "systemPrompt", tokens: 12900 },
      { id: "skills", tokens: 6500 }, { id: "memory", tokens: 2500 }, { id: "buffer", tokens: 33000 }, { id: "free", tokens: 157100 },
    ], deferred: [{ id: "mcpTools", tokens: 65900 }, { id: "systemTools", tokens: 25500 }], mcpTools: ["mcp__a__one", "mcp__b__two"], untilCompact: 150000 };
    it("renders rows, deferred rows, percent, tool names and until auto-compact, and compacts on click", () => {
      const onCompact = vi.fn();
      render(<CodeSessionRail {...props()} contextReport={report} onCompact={onCompact} />);
      expect(screen.getByText("62% used")).toBeTruthy();
      expect(screen.getByText("309.9k / 500k")).toBeTruthy();
      const rows = Object.fromEntries([...document.querySelectorAll(".code-context-report > div")].map(row => [row.querySelector("dt")?.textContent, [...row.querySelectorAll("dd")].map(dd => dd.textContent)]));
      expect(rows["Messages"]).toEqual(["238.7k", "47.7%"]);
      expect(rows["Autocompact buffer"]).toEqual(["33k", "6.6%"]);
      expect(rows["Free space"]).toEqual(["157.1k", "31.4%"]);
      expect(rows["MCP tools (deferred)"]).toEqual(["65.9k", "—"]);
      expect(rows["System tools (deferred)"]).toEqual(["25.5k", "—"]);
      expect(document.querySelectorAll(".code-context-bar > span").length).toBe(7);
      expect(screen.getByText("mcp__a__one")).toBeTruthy();
      expect(screen.getByText("150k until auto-compact")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Compact session" }));
      expect(onCompact).toHaveBeenCalledTimes(1);
    });
    it("says auto-compact is off and shows unknown values as dashes", () => {
      render(<CodeSessionRail {...props()} contextReport={{ ...report, used: null, autoCompact: false, untilCompact: null, rows: report.rows.map(row => row.id === "messages" || row.id === "free" ? { ...row, tokens: null } : row) }} onCompact={vi.fn()} />);
      expect(screen.getByText("Auto-compact is off")).toBeTruthy();
      expect(screen.getByText("— used")).toBeTruthy();
    });
    it("says auto-compact is on without a number when the threshold is unknown", () => {
      render(<CodeSessionRail {...props()} contextReport={{ ...report, reserve: null, untilCompact: null }} onCompact={vi.fn()} />);
      expect(screen.getByText("Auto-compact is on")).toBeTruthy();
    });
    it("keeps today's view when there is no report", () => {
      const last = { totalTokens: 420, inputTokens: 420, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
      render(<CodeSessionRail {...props()} contextReport={null} usage={{ last, total: last, modelContextWindow: 1000 }} />);
      expect(screen.getByText("Latest reported usage")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Compact session" })).toBeNull();
      expect(document.querySelector(".code-context-report")).toBeNull();
    });
  });
});
