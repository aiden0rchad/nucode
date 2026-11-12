// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "@/types";
import { useWorkspaceSelection } from "./useWorkspaceSelection";

vi.mock("@sentry/react", () => ({ metrics: { count: vi.fn() } }));

const collapsed = { id: "w1", name: "One", path: "/tmp/one", connected: true, kind: "main", settings: { sidebarCollapsed: true } } as WorkspaceInfo;

function select(persistSidebarState?: boolean) {
  const updateWorkspaceSettings = vi.fn(async () => collapsed);
  const setActiveWorkspaceId = vi.fn();
  const { result } = renderHook(() =>
    useWorkspaceSelection({
      workspaces: [collapsed],
      isCompact: false,
      activeWorkspaceId: null,
      setActiveTab: vi.fn(),
      setActiveWorkspaceId,
      updateWorkspaceSettings,
      setCenterMode: vi.fn(),
      setSelectedDiffPath: vi.fn(),
      persistSidebarState,
    }),
  );
  result.current.selectWorkspace("w1");
  return { updateWorkspaceSettings, setActiveWorkspaceId };
}

describe("useWorkspaceSelection", () => {
  it("expands a collapsed project in the sidebar when it is selected", () => {
    const { updateWorkspaceSettings, setActiveWorkspaceId } = select();
    expect(setActiveWorkspaceId).toHaveBeenCalledWith("w1");
    expect(updateWorkspaceSettings).toHaveBeenCalledWith("w1", { sidebarCollapsed: false });
  });

  it("does not write the project's sidebar state when told not to", () => {
    const { updateWorkspaceSettings, setActiveWorkspaceId } = select(false);
    expect(setActiveWorkspaceId).toHaveBeenCalledWith("w1");
    expect(updateWorkspaceSettings).not.toHaveBeenCalled();
  });
});
