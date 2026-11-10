// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "@/types";
import { useWorkspaceOrderingOrchestration } from "./useWorkspaceOrchestration";

const project = (id: string, sortOrder: number, groupId?: string): WorkspaceInfo => ({
  id, name: id, path: `/${id}`, connected: true, settings: { sidebarCollapsed: false, sortOrder, groupId },
});

it.each(["before", "after"] as const)("persists only changed project positions when dropping %s", async position => {
  const workspaces = [project("a", 0), project("b", 1), project("c", 2), project("other", 0, "group")];
  const updateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useWorkspaceOrderingOrchestration({ workspaces, workspacesById: new Map(workspaces.map(w => [w.id, w])), updateWorkspaceSettings }));
  await act(() => result.current.handleReorderWorkspace("c", "a", position));
  expect(updateWorkspaceSettings.mock.calls).toEqual(position === "before"
    ? [["c", { sortOrder: 0 }], ["a", { sortOrder: 1 }], ["b", { sortOrder: 2 }]]
    : [["c", { sortOrder: 1 }], ["b", { sortOrder: 2 }]]);
});

it("rejects cross-group, missing, child and self drops", async () => {
  const workspaces = [project("a", 0), project("b", 1), project("other", 0, "group"),
    { ...project("tree", 2), kind: "worktree" as const, parentId: "a" },
    { ...project("clone", 3), settings: { sidebarCollapsed: false, cloneSourceWorkspaceId: "a" } }];
  const updateWorkspaceSettings = vi.fn();
  const { result } = renderHook(() => useWorkspaceOrderingOrchestration({ workspaces, workspacesById: new Map(workspaces.map(w => [w.id, w])), updateWorkspaceSettings }));
  for (const [from, to] of [["a", "other"], ["missing", "a"], ["tree", "a"], ["clone", "a"], ["a", "clone"], ["a", "a"], ["a", "b"]]) {
    await act(() => result.current.handleReorderWorkspace(from, to, "before"));
  }
  expect(updateWorkspaceSettings).not.toHaveBeenCalled();
});


it("moves a sidebar project past clone children without changing the Settings move behavior", async () => {
  const workspaces = [project("a", 0), { ...project("clone", 1), settings: { sidebarCollapsed: false, sortOrder: 1, cloneSourceWorkspaceId: "a" } }, project("b", 2)];
  const updateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useWorkspaceOrderingOrchestration({ workspaces, workspacesById: new Map(workspaces.map(w => [w.id, w])), updateWorkspaceSettings }));
  await act(() => result.current.handleMoveWorkspace("a", "down", true));
  expect(updateWorkspaceSettings.mock.calls).toEqual([["b", { sortOrder: 0 }], ["a", { sortOrder: 1 }]]);
  updateWorkspaceSettings.mockClear();
  await act(() => result.current.handleMoveWorkspace("a", "down"));
  expect(updateWorkspaceSettings.mock.calls).toEqual([["clone", { sortOrder: 0 }], ["a", { sortOrder: 1 }], ["b", { sortOrder: 2 }]]);
});
