// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ThreadSummary, WorkspaceInfo } from "../../../types";
import { SidebarActivity } from "./SidebarActivity";

const workspace = (id: string, name: string) => ({ id, name, path: `/tmp/${id}`, connected: true, settings: {} }) as unknown as WorkspaceInfo;
const thread = (id: string, name: string, updatedAt: number, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({ id, name, updatedAt, ...extra });

describe("SidebarActivity", () => {
  it("lists recent threads across projects, newest first, with their state", () => {
    const onSelectThread = vi.fn();
    const now = Date.now();
    render(<SidebarActivity
      workspaces={[workspace("a", "Atlas"), workspace("b", "Orbit")]}
      threadsByWorkspace={{ a: [thread("t1", "Older", now - 60_000), thread("sub", "Helper", now, { isSubagent: true })], b: [thread("t2", "Newest", now - 1_000)] }}
      threadStatusById={{ t2: { isProcessing: true } }}
      pendingUserInputKeys={new Set()}
      onSelectThread={onSelectThread}
    />);
    const toggle = screen.getByRole("button", { name: "Activity" });
    expect(toggle.querySelector(".sidebar-activity-dot")).toBeTruthy();
    fireEvent.click(toggle);
    const items = screen.getAllByRole("button").filter(button => button.classList.contains("sidebar-activity-item"));
    expect(items.map(item => item.querySelector(".sidebar-activity-name")?.textContent)).toEqual(["Newest", "Older"]);
    expect(items[0].textContent).toContain("Running");
    fireEvent.click(items[1]);
    expect(onSelectThread).toHaveBeenCalledWith("a", "t1");
    expect(screen.queryByRole("dialog", { name: "Recent activity" })).toBeNull();
  });
});
