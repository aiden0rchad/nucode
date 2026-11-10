// @vitest-environment jsdom
import { assertRowAlignment } from "@/test/rowAlignment.mjs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { useThreadStorage } from "@threads/hooks/useThreadStorage";
import { setupPointerEvents } from "@/test/pointerEvents";
import { Sidebar } from "./Sidebar";

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
  assertRowAlignment(document.body);
  cleanup();
});

const baseProps = {
  workspaces: [],
  groupedWorkspaces: [],
  hasWorkspaceGroups: false,
  deletingWorktreeIds: new Set<string>(),
  threadsByWorkspace: {},
  threadParentById: {},
  threadStatusById: {},
  threadListLoadingByWorkspace: {},
  threadListPagingByWorkspace: {},
  threadListCursorByWorkspace: {},
  pinnedThreadsVersion: 0,
  threadListSortKey: "updated_at" as const,
  onSetThreadListSortKey: vi.fn(),
  threadListOrganizeMode: "by_project" as const,
  onSetThreadListOrganizeMode: vi.fn(),
  onRefreshAllThreads: vi.fn(),
  activeWorkspaceId: null,
  activeThreadId: null,






  onOpenSettings: vi.fn(),
  onOpenDebug: vi.fn(),
  showDebugButton: false,
  onAddWorkspace: vi.fn(),
  onSelectHome: vi.fn(),
  onSelectWorkspace: vi.fn(),
  onConnectWorkspace: vi.fn(),
  onAddAgent: vi.fn(),
  onAddWorktreeAgent: vi.fn(),
  onAddCloneAgent: vi.fn(),
  onToggleWorkspaceCollapse: vi.fn(),
  onSelectThread: vi.fn(),
  onDeleteThread: vi.fn(),
  onSyncThread: vi.fn(),
  pinThread: vi.fn(() => false),
  unpinThread: vi.fn(),
  isThreadPinned: vi.fn(() => false),
  getPinTimestamp: vi.fn(() => null),
  onRenameThread: vi.fn(),
  onDeleteWorkspace: vi.fn(),
  onDeleteWorktree: vi.fn(),
  onLoadOlderThreads: vi.fn(),
  onReloadWorkspaceThreads: vi.fn(),
  workspaceDropTargetRef: createRef<HTMLElement>(),
  isWorkspaceDropActive: false,
  workspaceDropText: "Drop Project Here",
  onWorkspaceDragOver: vi.fn(),
  onWorkspaceDragEnter: vi.fn(),
  onWorkspaceDragLeave: vi.fn(),
  onWorkspaceDrop: vi.fn(),
};

describe("Sidebar", () => {
  it("uses a distinct Logs glyph and opens the debug log", () => {
    const onOpenDebug = vi.fn();
    const view = render(<Sidebar {...baseProps} showDebugButton onOpenDebug={onOpenDebug} />);
    const button = screen.getByRole("button", { name: "Open debug log" });
    expect(button.querySelector("svg.lucide-logs")).toBeTruthy();
    expect(button.querySelector("svg.lucide-scroll-text, svg.lucide-bug")).toBeNull();
    fireEvent.click(button);
    expect(onOpenDebug).toHaveBeenCalledOnce();
    view.rerender(<Sidebar {...baseProps} />);
    expect(screen.queryByRole("button", { name: "Open debug log" })).toBeNull();
  });
  it("cards projects including Ungrouped, keeps labels outside, and selects the active card", () => {
    const workspaces = [
      { id: "atlas", name: "Atlas", path: "/atlas", connected: true, settings: { sidebarCollapsed: false } },
      { id: "orbit", name: "Orbit", path: "/orbit", connected: true, settings: { sidebarCollapsed: true } },
      { id: "notes", name: "Notes", path: "/notes", connected: true, settings: { sidebarCollapsed: false } },
    ];
    const { container } = render(<Sidebar {...baseProps} workspaces={workspaces}
      hasWorkspaceGroups activeWorkspaceId="atlas" groupedWorkspaces={[
        { id: "studio", name: "Studio", workspaces: workspaces.slice(0, 2) },
        { id: null, name: "Ungrouped", workspaces: workspaces.slice(2) },
      ]} threadsByWorkspace={{ notes: [{ id: "note", name: "A note", updatedAt: 1 }] }} />);
    expect(container.querySelectorAll(".workspace-card.squircle")).toHaveLength(3);
    expect(container.querySelector(".sidebar .squircle .squircle")).toBeNull();
    expect(screen.getByRole("button", { name: "Notes" }).closest(".workspace-card.squircle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Atlas" }).closest(".project-group-card")?.classList.contains("is-selected")).toBe(true);
    expect(screen.getByRole("button", { name: "Orbit" }).closest(".project-group-card")?.querySelector(".workspace-card-content")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("A note").closest(".project-group-card")).toBe(screen.getByRole("button", { name: "Notes" }).closest(".project-group-card"));
    for (const label of ["Studio", "Ungrouped"]) expect(screen.getByText(label).closest(".squircle")).toBeNull();
  });
  it("toggles the search bar from the header icon", () => {
    render(<Sidebar {...baseProps} />);

    const toggleButton = screen.getByRole("button", { name: "Toggle search" });
    expect(screen.queryByLabelText("Search conversations")).toBeNull();

    fireEvent.click(toggleButton);
    const input = screen.getByLabelText("Search conversations") as HTMLInputElement;
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: "alpha" } });
    expect(input.value).toBe("alpha");

    fireEvent.click(toggleButton);
    expect(screen.queryByLabelText("Search conversations")).toBeNull();

    fireEvent.click(toggleButton);
    const reopened = screen.getByLabelText("Search conversations") as HTMLInputElement;
    expect(reopened.value).toBe("");
  });

  it("opens thread sort menu from the header filter button", () => {
    const onSetThreadListSortKey = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        threadListSortKey="updated_at"
        onSetThreadListSortKey={onSetThreadListSortKey}
      />,
    );

    const button = screen.getByRole("button", { name: "Organize and sort threads" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(button);
    const option = screen.getByRole("menuitemradio", { name: "Created" });
    fireEvent.click(option);

    expect(onSetThreadListSortKey).toHaveBeenCalledWith("created_at");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("changes organize mode from the header filter menu", () => {
    const onSetThreadListOrganizeMode = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        threadListOrganizeMode="by_project"
        onSetThreadListOrganizeMode={onSetThreadListOrganizeMode}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Organize and sort threads" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Thread list" }));

    expect(onSetThreadListOrganizeMode).toHaveBeenCalledWith("threads_only");
  });





  it("renders threads-only mode as a global chronological list", () => {
    const older = Date.now() - 10_000;
    const newer = Date.now();
    const { container } = render(
      <Sidebar
        {...baseProps}
        threadListOrganizeMode="threads_only"
        workspaces={[
          {
            id: "ws-1",
            name: "Alpha Project",
            path: "/tmp/alpha",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
          {
            id: "ws-2",
            name: "Beta Project",
            path: "/tmp/beta",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Alpha Project",
                path: "/tmp/alpha",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
              {
                id: "ws-2",
                name: "Beta Project",
                path: "/tmp/beta",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [{ id: "thread-1", name: "Older thread", updatedAt: older }],
          "ws-2": [{ id: "thread-2", name: "Newer thread", updatedAt: newer }],
        }}
      />,
    );

    const renderedNames = Array.from(container.querySelectorAll(".thread-row .thread-name")).map(
      (node) => node.textContent?.trim(),
    );
    expect(screen.getByText("Recent conversations")).toBeTruthy();
    expect(renderedNames[0]).toBe("Newer thread");
    expect(renderedNames[1]).toBe("Older thread");
    expect(screen.getByText("Alpha Project")).toBeTruthy();
    expect(screen.getByText("Beta Project")).toBeTruthy();
  });

  it("keeps a project visible when its thread matches the search query", async () => {
    render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-1",
            name: "Alpha Project",
            path: "/tmp/alpha",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
          {
            id: "ws-2",
            name: "Beta Project",
            path: "/tmp/beta",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Alpha Project",
                path: "/tmp/alpha",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
              {
                id: "ws-2",
                name: "Beta Project",
                path: "/tmp/beta",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [{ id: "thread-1", name: "Fix workspace restore", updatedAt: 1000 }],
          "ws-2": [{ id: "thread-2", name: "Unrelated thread", updatedAt: 900 }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle search" }));
    fireEvent.change(screen.getByLabelText("Search conversations"), {
      target: { value: "restore" },
    });

    await waitFor(() => {
      expect(screen.getByText("Alpha Project")).toBeTruthy();
      expect(screen.getByText("Fix workspace restore")).toBeTruthy();
      expect(screen.queryByText("Beta Project")).toBeNull();
      expect(screen.queryByText("Unrelated thread")).toBeNull();
    });
  });

  it("searches across loaded root threads before collapsed truncation", async () => {
    render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-1",
            name: "Alpha Project",
            path: "/tmp/alpha",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Alpha Project",
                path: "/tmp/alpha",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            { id: "thread-1", name: "Alpha thread", updatedAt: 1000 },
            { id: "thread-2", name: "Beta thread", updatedAt: 900 },
            { id: "thread-3", name: "Gamma thread", updatedAt: 800 },
            { id: "thread-4", name: "Delta thread", updatedAt: 700 },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle search" }));
    fireEvent.change(screen.getByLabelText("Search conversations"), {
      target: { value: "delta" },
    });

    await waitFor(() => {
      expect(screen.getByText("Alpha Project")).toBeTruthy();
      expect(screen.getByText("Delta thread")).toBeTruthy();
      expect(screen.queryByText("Alpha thread")).toBeNull();
      expect(screen.queryByText("More...")).toBeNull();
    });
  });

  it("keeps a project visible during search when only older pages may contain matches", async () => {
    render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-1",
            name: "Alpha Project",
            path: "/tmp/alpha",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Alpha Project",
                path: "/tmp/alpha",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [{ id: "thread-1", name: "Current page thread", updatedAt: 1000 }],
        }}
        threadListCursorByWorkspace={{ "ws-1": "cursor-1" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle search" }));
    fireEvent.change(screen.getByLabelText("Search conversations"), {
      target: { value: "historical" },
    });

    await waitFor(() => {
      expect(screen.getByText("Alpha Project")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Search older..." })).toBeTruthy();
      expect(screen.queryByText("Current page thread")).toBeNull();
    });
  });

  it("keeps the parent project visible when only a worktree thread matches search", async () => {
    render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-root",
            name: "Main Project",
            path: "/tmp/main",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
          {
            id: "ws-worktree",
            name: "Feature Worktree",
            path: "/tmp/main-feature",
            connected: true,
            kind: "worktree",
            parentId: "ws-root",
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-root",
                name: "Main Project",
                path: "/tmp/main",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        threadsByWorkspace={{
          "ws-worktree": [
            { id: "thread-worktree", name: "Feature thread routing fix", updatedAt: 1000 },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle search" }));
    fireEvent.change(screen.getByLabelText("Search conversations"), {
      target: { value: "routing fix" },
    });

    await waitFor(() => {
      expect(screen.getByText("Main Project")).toBeTruthy();
      expect(screen.getByText("Worktrees")).toBeTruthy();
      expect(screen.getByText("Feature Worktree")).toBeTruthy();
      expect(screen.getByText("Feature thread routing fix")).toBeTruthy();
    });
  });

  it("keeps clone agents visible when their thread matches search", async () => {
    render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-root",
            name: "Main Project",
            path: "/tmp/main",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
          {
            id: "ws-clone",
            name: "Clone Agent",
            path: "/tmp/main-clone",
            connected: true,
            settings: {
              sidebarCollapsed: false,
              cloneSourceWorkspaceId: "ws-root",
            },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-root",
                name: "Main Project",
                path: "/tmp/main",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
              {
                id: "ws-clone",
                name: "Clone Agent",
                path: "/tmp/main-clone",
                connected: true,
                settings: {
                  sidebarCollapsed: false,
                  cloneSourceWorkspaceId: "ws-root",
                },
              },
            ],
          },
        ]}
        threadsByWorkspace={{
          "ws-clone": [
            { id: "thread-clone", name: "Investigate clone search bug", updatedAt: 1000 },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle search" }));
    fireEvent.change(screen.getByLabelText("Search conversations"), {
      target: { value: "clone search bug" },
    });

    await waitFor(() => {
      expect(screen.getByText("Main Project")).toBeTruthy();
      expect(screen.getByText("Clone agents")).toBeTruthy();
      expect(screen.getByText("Clone Agent")).toBeTruthy();
      expect(screen.getByText("Investigate clone search bug")).toBeTruthy();
    });
  });

  it("creates a new thread from the all-threads project picker", () => {
    const onAddAgent = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        threadListOrganizeMode="threads_only"
        onAddAgent={onAddAgent}
        workspaces={[
          {
            id: "ws-1",
            name: "Alpha Project",
            path: "/tmp/alpha",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
          {
            id: "ws-2",
            name: "Beta Project",
            path: "/tmp/beta",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Alpha Project",
                path: "/tmp/alpha",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
              {
                id: "ws-2",
                name: "Beta Project",
                path: "/tmp/beta",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New thread in project" }));
    fireEvent.click(screen.getByRole("button", { name: "Alpha Project" }));

    expect(onAddAgent).toHaveBeenCalledTimes(1);
    expect(onAddAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "ws-1" }));
  });

  it("refreshes all workspace threads from the header button", () => {
    const onRefreshAllThreads = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-1",
            name: "Workspace",
            path: "/tmp/workspace",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Workspace",
                path: "/tmp/workspace",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        onRefreshAllThreads={onRefreshAllThreads}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh all workspace threads" }));
    expect(onRefreshAllThreads).toHaveBeenCalledTimes(1);
  });

  it("spins the refresh icon while workspace threads are refreshing", () => {
    render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-1",
            name: "Workspace",
            path: "/tmp/workspace",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Workspace",
                path: "/tmp/workspace",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        threadListLoadingByWorkspace={{ "ws-1": true }}
      />,
    );

    const refreshButton = screen.getByRole("button", { name: "Refresh all workspace threads" });
    expect(refreshButton.getAttribute("aria-busy")).toBe("true");
    const icon = refreshButton.querySelector("svg");
    expect(icon?.getAttribute("class") ?? "").toContain("spinning");
  });

  it("shows a top New Agent draft row and selects workspace when clicked", () => {
    const onSelectWorkspace = vi.fn();
    const props = {
      ...baseProps,
      workspaces: [
        {
          id: "ws-1",
          name: "Workspace",
          path: "/tmp/workspace",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
      ],
      groupedWorkspaces: [
        {
          id: null,
          name: "Workspaces",
          workspaces: [
            {
              id: "ws-1",
              name: "Workspace",
              path: "/tmp/workspace",
              connected: true,
              settings: { sidebarCollapsed: false },
            },
          ],
        },
      ],
      newAgentDraftWorkspaceId: "ws-1",
      activeWorkspaceId: "ws-1",
      activeThreadId: null,
      onSelectWorkspace,
    };

    render(<Sidebar {...props} />);

    const draftRow = screen.getByRole("button", { name: /new agent/i });
    expect(draftRow).toBeTruthy();
    expect(draftRow.className).toContain("thread-row-draft");
    expect(draftRow.className).toContain("active");

    fireEvent.click(draftRow);
    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-1");
  });

  it("renders clone agents nested under their source project", () => {
    const { container } = render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-1",
            name: "Main Project",
            path: "/tmp/main",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
          {
            id: "ws-2",
            name: "Clone Agent",
            path: "/tmp/main-copy",
            connected: true,
            settings: {
              sidebarCollapsed: false,
              cloneSourceWorkspaceId: "ws-1",
            },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Main Project",
                path: "/tmp/main",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
              {
                id: "ws-2",
                name: "Clone Agent",
                path: "/tmp/main-copy",
                connected: true,
                settings: {
                  sidebarCollapsed: false,
                  cloneSourceWorkspaceId: "ws-1",
                },
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("Clone agents")).toBeTruthy();
    expect(screen.getByText("Clone Agent")).toBeTruthy();
    expect(container.querySelectorAll(".workspace-row")).toHaveLength(1);
    expect(container.querySelectorAll(".worktree-row")).toHaveLength(1);
  });

  it("sorts by project activity using clone-thread activity for the source project", () => {
    const { container } = render(
      <Sidebar
        {...baseProps}
        threadListOrganizeMode="by_project_activity"
        workspaces={[
          {
            id: "ws-a",
            name: "Alpha Project",
            path: "/tmp/alpha",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
          {
            id: "ws-a-clone",
            name: "Alpha Clone",
            path: "/tmp/alpha-clone",
            connected: true,
            settings: {
              sidebarCollapsed: false,
              cloneSourceWorkspaceId: "ws-a",
            },
          },
          {
            id: "ws-b",
            name: "Beta Project",
            path: "/tmp/beta",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-a",
                name: "Alpha Project",
                path: "/tmp/alpha",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
              {
                id: "ws-a-clone",
                name: "Alpha Clone",
                path: "/tmp/alpha-clone",
                connected: true,
                settings: {
                  sidebarCollapsed: false,
                  cloneSourceWorkspaceId: "ws-a",
                },
              },
              {
                id: "ws-b",
                name: "Beta Project",
                path: "/tmp/beta",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        threadsByWorkspace={{
          "ws-a": [{ id: "thread-a", name: "Alpha root", updatedAt: 100 }],
          "ws-a-clone": [
            { id: "thread-a-clone", name: "Alpha clone thread", updatedAt: 300 },
          ],
          "ws-b": [{ id: "thread-b", name: "Beta root", updatedAt: 200 }],
        }}
      />,
    );

    const workspaceNames = Array.from(
      container.querySelectorAll(".workspace-row .workspace-name"),
    ).map((node) => node.textContent?.trim());
    expect(workspaceNames[0]).toBe("Alpha Project");
    expect(workspaceNames[1]).toBe("Beta Project");
  });

  it("does not show a workspace activity indicator when a thread is processing", () => {
    render(
      <Sidebar
        {...baseProps}
        workspaces={[
          {
            id: "ws-1",
            name: "Workspace",
            path: "/tmp/workspace",
            connected: true,
            settings: { sidebarCollapsed: false },
          },
        ]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Workspaces",
            workspaces: [
              {
                id: "ws-1",
                name: "Workspace",
                path: "/tmp/workspace",
                connected: true,
                settings: { sidebarCollapsed: false },
              },
            ],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "thread-1",
              name: "Thread 1",
              updated_at: new Date().toISOString(),
            } as never,
          ],
        }}
        threadStatusById={{
          "thread-1": { isProcessing: true, hasUnread: false, isReviewing: false },
        }}
      />,
    );

    const indicator = screen.queryByTitle("Streaming updates in progress");
    expect(indicator).toBeNull();
  });
});


function pointerEvent(row: HTMLElement, type: "pointerDown" | "pointerMove" | "pointerUp", clientY = 0) {
  if (type === "pointerDown") {
    fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  } else {
    vi.mocked(document.elementFromPoint).mockReturnValue(row);
    fireEvent[type](window, { pointerId: 1, clientX: 20, clientY });
  }
}

describe("sidebar reorder and row pins", () => {
  setupPointerEvents();
  afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  const projects = ["Alpha project", "Beta project", "Other project"].map((name, index) => ({
    id: `ws-${index}`, name, path: `/project-${index}`, connected: true,
    settings: { sidebarCollapsed: false, sortOrder: index, groupId: index === 2 ? "other" : "group" },
  }));
  const groups = [{ id: "group", name: "Group", workspaces: projects.slice(0, 2) }, { id: "other", name: "Other", workspaces: projects.slice(2) }];
  const threads = Object.fromEntries(projects.map((project, index) => [project.id,
    ["a", "b", "c", "d", "pin1", "pin2"].map((id, i) => ({ id: `${index}-${id}`, name: `${index}-${id}`, updatedAt: 100 - i })),
  ]));
  const props = { ...baseProps, workspaces: projects, groupedWorkspaces: groups, threadsByWorkspace: threads,
    isThreadPinned: (_workspaceId: string, id: string) => id.includes("pin"),
    getPinTimestamp: (_workspaceId: string, id: string) => id.includes("pin") ? Number(id.slice(-1)) : null,
  };
  const row = (name: string) => screen.getByRole("button", { name });
  const saved = () => JSON.parse(localStorage.getItem("nucode.threadOrder.v1") ?? "{}");
  const rendered = (name = "Alpha project") => Array.from(row(name).closest(".workspace-card")!.querySelectorAll(".thread-row")).map(el => el.getAttribute("aria-label"));

  it.each(["by_project", "by_project_activity", "threads_only"] as const)("keeps pins global and non-draggable in %s", mode => {
    render(<Sidebar {...props} threadListOrganizeMode={mode} />);
    const pinned = screen.getByText("Pinned conversations").closest(".pinned-section")!;
    expect(pinned.querySelectorAll(".thread-row")).toHaveLength(6);
    for (const name of ["0-pin1", "0-pin2", "1-pin1", "1-pin2", "2-pin1", "2-pin2"]) {
      const thread = row(name);
      expect(thread.closest(".pinned-section")).toBe(pinned);
      expect(thread.hasAttribute("data-reorder-id")).toBe(false);
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    }
    if (mode !== "threads_only") {
      expect(rendered()).toEqual(["0-a", "0-b", "0-c"]);
      expect(row("Alpha project").title).toMatch(/^Alpha project · 4 conversations/);
    }
  });

  it("reorders full root sections, preserves unloaded ids, and rejects other projects, sections and headers", () => {
    localStorage.setItem("nucode.threadOrder.v1", JSON.stringify({ "ws-0": ["unloaded-a", "unloaded-b"] }));
    render(<Sidebar {...props} />);
    pointerEvent(row("0-c"), "pointerDown");
    expect(row("0-c").hasAttribute("draggable")).toBe(false);
    for (const target of ["1-a", "0-pin1", "Alpha project"]) {
      pointerEvent(row(target), "pointerMove");
      expect(document.body.classList.contains("sidebar-reorder-invalid")).toBe(true);
      expect(row(target).hasAttribute("data-drop-edge")).toBe(false);
      pointerEvent(row(target), "pointerUp");
      expect(saved()["ws-0"]).toEqual(["unloaded-a", "unloaded-b"]);
      pointerEvent(row("0-c"), "pointerDown");
    }
    pointerEvent(row("0-a"), "pointerMove", -1);
    expect(row("0-c").getAttribute("data-dragging")).toBe("true");
    expect(row("0-a").getAttribute("data-drop-edge")).toBe("before");
    pointerEvent(row("0-a"), "pointerUp", -1);
    expect(document.body.classList.contains("sidebar-reordering")).toBe(false);
    expect(rendered()).toEqual(["0-c", "0-a", "0-b"]);
    expect(saved()["ws-0"]).toEqual(["0-c", "0-a", "0-b", "0-d", "unloaded-a", "unloaded-b"]);
    expect(baseProps.onSelectThread).not.toHaveBeenCalled();
    expect(baseProps.onSyncThread).not.toHaveBeenCalled();
    pointerEvent(row("0-pin1"), "pointerDown");
    pointerEvent(row("0-pin2"), "pointerMove", 1);
    pointerEvent(row("0-pin2"), "pointerUp", 1);
    expect(rendered()).toEqual(["0-c", "0-a", "0-b"]);
    expect(saved()["ws-0"]).toEqual(["0-c", "0-a", "0-b", "0-d", "unloaded-a", "unloaded-b"]);
  });

  it("moves focused threads within their full section with Alt+ArrowUp/Down", () => {
    render(<Sidebar {...props} />);
    row("0-c").focus();
    fireEvent.keyDown(row("0-c"), { altKey: true, key: "ArrowDown" });
    expect(saved()["ws-0"]).toEqual(["0-a", "0-b", "0-d", "0-c"]);
    fireEvent.keyDown(row("0-pin2"), { altKey: true, key: "ArrowUp" });
    expect(saved()["ws-0"]).toEqual(["0-a", "0-b", "0-d", "0-c"]);
    fireEvent.keyDown(row("0-pin2"), { altKey: true, key: "ArrowUp" });
    expect(saved()["ws-0"]).toEqual(["0-a", "0-b", "0-d", "0-c"]);
    expect(baseProps.onSelectThread).not.toHaveBeenCalled();
  });

  it.each([["0-a", "0-b", "thread"], ["Alpha project", "Beta project", "project"]])(
    "keeps plain clicks and cancels %s reordering with Escape", (sourceName, targetName, kind) => {
      const onReorderWorkspace = vi.fn();
      render(<Sidebar {...props} onReorderWorkspace={onReorderWorkspace} />);
      const source = row(sourceName);
      const selected = kind === "thread" ? baseProps.onSelectThread : baseProps.onSelectWorkspace;
      pointerEvent(source, "pointerDown");
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.click(source);
      expect(selected).toHaveBeenCalledOnce();
      pointerEvent(source, "pointerDown");
      pointerEvent(row(targetName), "pointerMove");
      expect(row(targetName).hasAttribute("data-drop-edge")).toBe(true);
      fireEvent.keyDown(window, { key: "Escape" });
      pointerEvent(row(targetName), "pointerUp");
      fireEvent.click(row(targetName));
      expect(selected).toHaveBeenCalledOnce();
      expect(onReorderWorkspace).not.toHaveBeenCalled();
      expect(saved()).toEqual({});
      expect(document.body.classList.contains("sidebar-reordering")).toBe(false);
    },
  );

  it.each([[-1, "before"], [1, "after"]] as const)("drops projects at the correct edge (%s)", (y, position) => {
    const onReorderWorkspace = vi.fn();
    const onMoveWorkspace = vi.fn();
    render(<Sidebar {...props} onReorderWorkspace={onReorderWorkspace} onMoveWorkspace={onMoveWorkspace} />);
    pointerEvent(row("Alpha project"), "pointerDown");
    pointerEvent(row("Other project"), "pointerMove");
    expect(document.body.classList.contains("sidebar-reorder-invalid")).toBe(true);
    pointerEvent(row("Other project"), "pointerUp");
    expect(onReorderWorkspace).not.toHaveBeenCalled();
    pointerEvent(row("Alpha project"), "pointerDown");
    pointerEvent(row("Beta project"), "pointerMove", y);
    expect(row("Beta project").getAttribute("data-drop-edge")).toBe(position);
    pointerEvent(row("Beta project"), "pointerUp", y);
    expect(onReorderWorkspace).toHaveBeenCalledWith("ws-0", "ws-1", position);
    row("Alpha project").focus();
    fireEvent.keyDown(row("Alpha project"), { altKey: true, key: "ArrowDown" });
    fireEvent.keyDown(row("Alpha project"), { altKey: true, key: "ArrowUp" });
    expect(onMoveWorkspace.mock.calls).toEqual([["ws-0", "down"], ["ws-0", "up"]]);
    expect(baseProps.onSelectWorkspace).not.toHaveBeenCalled();
  });

  it("disables project dragging in activity mode and all dragging during search or recent mode", async () => {
    const onReorderWorkspace = vi.fn();
    const { rerender } = render(<Sidebar {...props} onReorderWorkspace={onReorderWorkspace} threadListOrganizeMode="by_project_activity" />);
    expect(row("Alpha project").hasAttribute("data-reorder-id")).toBe(false);
    expect(row("0-a").hasAttribute("data-reorder-id")).toBe(true);
    rerender(<Sidebar {...props} onReorderWorkspace={onReorderWorkspace} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "0-a" } });
    await waitFor(() => expect(row("0-a").hasAttribute("data-reorder-id")).toBe(false));
    expect(row("Alpha project").hasAttribute("data-reorder-id")).toBe(false);
    rerender(<Sidebar {...props} threadListOrganizeMode="threads_only" />);
    expect(row("0-a").hasAttribute("data-reorder-id")).toBe(false);
  });

  it("moves pins to the global section without selecting or changing manual order", () => {
    function LivePins() {
      const pins = useThreadStorage();
      return <Sidebar {...props} {...pins} />;
    }
    const order = ["0-a", "0-b", "0-c", "0-d", "0-pin1", "0-pin2"];
    localStorage.setItem("nucode.threadOrder.v1", JSON.stringify({ "ws-0": order }));
    const { unmount } = render(<LivePins />);
    fireEvent.click(row("0-b").querySelector(".thread-pin-trigger")!);
    expect(row("0-b").closest(".pinned-section")).toBeTruthy();
    expect(row("0-b").closest(".workspace-card")).toBeNull();
    expect(screen.getAllByRole("button", { name: "0-b" })).toHaveLength(1);
    expect(rendered()).toEqual(["0-a", "0-c", "0-d"]);
    expect(saved()["ws-0"]).toEqual(order);
    expect(row("0-b").querySelector(".thread-pin-trigger")?.classList.contains("is-pinned")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Unpin thread" }));
    expect(screen.queryByRole("button", { name: "Unpin thread" })).toBeNull();
    expect(rendered()).toEqual(["0-a", "0-b", "0-c"]);
    expect(saved()["ws-0"]).toEqual(order);
    expect(baseProps.onSelectThread).not.toHaveBeenCalled();
    unmount();
    localStorage.clear();
    render(<Sidebar {...props} />);
    const pin = row("0-b").querySelector(".thread-pin-trigger")!;
    expect(pin.classList.contains("is-pinned")).toBe(false);
    fireEvent.click(pin);
    expect(baseProps.pinThread).toHaveBeenCalledWith("ws-0", "0-b");
    expect(saved()).toEqual({});
  });
});
