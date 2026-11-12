// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

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

const project = (id: string, name: string, groupId: string | null = null) => ({
  id,
  name,
  path: `/${id}`,
  connected: true,
  settings: { sidebarCollapsed: false, groupId },
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const projectNames = () =>
  Array.from(document.querySelectorAll(".workspace-row .workspace-name")).map((node) => node.textContent);

describe("project pins", () => {
  const alpha = project("a", "Alpha");
  const beta = project("b", "Beta");
  const gamma = project("c", "Gamma");
  const props = {
    ...baseProps,
    workspaces: [alpha, beta, gamma],
    groupedWorkspaces: [{ id: null, name: "Ungrouped", workspaces: [alpha, beta, gamma] }],
  };

  const choose = (name: string, item: string) => {
    fireEvent.contextMenu(screen.getByRole("button", { name }));
    fireEvent.click(screen.getByRole("menuitem", { name: item }));
  };

  it("sorts pinned projects first in the order they were pinned and keeps the rest in place", () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 10));
    render(<Sidebar {...props} />);
    expect(projectNames()).toEqual(["Alpha", "Beta", "Gamma"]);
    choose("Gamma", "Pin");
    expect(projectNames()).toEqual(["Gamma", "Alpha", "Beta"]);
    choose("Beta", "Pin");
    expect(projectNames()).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(document.querySelectorAll(".workspace-pin-glyph")).toHaveLength(2);
    expect(within(screen.getByRole("button", { name: "Beta" })).getByLabelText("Pinned")).toBeTruthy();
    choose("Gamma", "Unpin");
    expect(projectNames()).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("keeps pins across a remount", () => {
    const first = render(<Sidebar {...props} />);
    choose("Beta", "Pin");
    first.unmount();
    render(<Sidebar {...props} />);
    expect(projectNames()).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("only reorders pinned projects inside their own section", () => {
    const inWork = project("d", "Delta", "work");
    const grouped = {
      ...baseProps,
      workspaces: [alpha, inWork, beta],
      hasWorkspaceGroups: true,
      groupedWorkspaces: [
        { id: "work", name: "Work", workspaces: [inWork] },
        { id: null, name: "Ungrouped", workspaces: [alpha, beta] },
      ],
    };
    render(<Sidebar {...grouped} />);
    choose("Beta", "Pin");
    expect(projectNames()).toEqual(["Delta", "Beta", "Alpha"]);
  });
});

describe("project menu actions", () => {
  it("opens the project settings from Edit and files a project under a new section", async () => {
    const alpha = project("a", "Alpha");
    const onEditProject = vi.fn();
    const onCreateSection = vi.fn(async () => "g-new");
    const onAssignWorkspaceSection = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        workspaces={[alpha]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [alpha] }]}
        workspaceSections={[]}
        onEditProject={onEditProject}
        onCreateSection={onCreateSection}
        onAssignWorkspaceSection={onAssignWorkspaceSection}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEditProject).toHaveBeenCalledWith("a");

    fireEvent.contextMenu(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    const input = screen.getByPlaceholderText("New section…");
    fireEvent.change(input, { target: { value: "Studio" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onAssignWorkspaceSection).toHaveBeenCalledWith("a", "g-new"));
    expect(onCreateSection).toHaveBeenCalledWith("Studio");
  });
});

describe("chats filed under a section", () => {
  const alpha = project("a", "Alpha", "s1");
  const threads = {
    a: [
      { id: "t1", name: "Plan the launch", updatedAt: 20 },
      { id: "t2", name: "Fix the build", updatedAt: 10 },
    ],
  };
  const sectioned = (patch: Record<string, unknown> = {}) => ({
    ...baseProps,
    workspaces: [alpha],
    hasWorkspaceGroups: true,
    groupedWorkspaces: [{ id: "s1", name: "Work", workspaces: [alpha] }],
    workspaceSections: [{ id: "s1", name: "Work" }],
    threadsByWorkspace: threads,
    ...patch,
  });
  const store = (value: Record<string, string>) =>
    localStorage.setItem("codexmonitor.threadSections", JSON.stringify(value));

  it("lists a filed chat under the section header, above the projects, and not under its project", () => {
    store({ "a:t1": "s1" });
    render(<Sidebar {...sectioned()} />);
    const group = screen.getByText("Work").closest(".workspace-group")!;
    const filed = group.querySelector(".section-thread-list")!;
    expect(filed).toBeTruthy();
    expect(within(filed as HTMLElement).getByText("Plan the launch")).toBeTruthy();
    // The project name appears as secondary text, as in the pinned list.
    expect(filed.querySelector(".thread-workspace-label")?.textContent).toBe("Alpha");
    const card = screen.getByRole("button", { name: "Alpha" }).closest(".workspace-card")!;
    expect(within(card as HTMLElement).queryByText("Plan the launch")).toBeNull();
    expect(within(card as HTMLElement).getByText("Fix the build")).toBeTruthy();
    expect(
      filed.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("falls back to the project list when the stored section is gone", () => {
    store({ "a:t1": "deleted-section" });
    render(<Sidebar {...sectioned()} />);
    expect(document.querySelector(".section-thread-list")).toBeNull();
    const card = screen.getByRole("button", { name: "Alpha" }).closest(".workspace-card")!;
    expect(within(card as HTMLElement).getByText("Plan the launch")).toBeTruthy();
  });

  it("keeps a pinned chat in the pinned list", () => {
    store({ "a:t1": "s1" });
    render(
      <Sidebar
        {...sectioned()}
        isThreadPinned={(_workspaceId: string, id: string) => id === "t1"}
        getPinTimestamp={(_workspaceId: string, id: string) => (id === "t1" ? 5 : null)}
      />,
    );
    expect(document.querySelector(".section-thread-list")).toBeNull();
    const pinned = screen.getByText("Pinned conversations").closest(".pinned-section")!;
    expect(within(pinned as HTMLElement).getByText("Plan the launch")).toBeTruthy();
  });

  it("gives a section that only holds chats its own header", () => {
    store({ "a:t1": "s2" });
    const loose = project("a", "Alpha");
    render(
      <Sidebar
        {...sectioned({
          workspaces: [loose],
          groupedWorkspaces: [{ id: null, name: "Ungrouped", workspaces: [loose] }],
          workspaceSections: [{ id: "s2", name: "Reading" }],
        })}
      />,
    );
    const group = screen.getByText("Reading").closest(".workspace-group")!;
    expect(within(group as HTMLElement).getByText("Plan the launch")).toBeTruthy();
  });

  it("moves a chat into a section from its menu and back out again", () => {
    render(<Sidebar {...sectioned()} />);
    const card = () => screen.getByRole("button", { name: "Alpha" }).closest(".workspace-card") as HTMLElement;
    expect(within(card()).getByText("Plan the launch")).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Plan the launch" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Work" }));
    expect(within(card()).queryByText("Plan the launch")).toBeNull();
    expect(JSON.parse(localStorage.getItem("codexmonitor.threadSections") ?? "{}")).toEqual({ "a:t1": "s1" });
    expect(document.querySelector(".section-thread-list")).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Plan the launch" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("menuitem", { name: "No section" }));
    expect(within(card()).getByText("Plan the launch")).toBeTruthy();
    expect(document.querySelector(".section-thread-list")).toBeNull();
  });

  it("does not file sub-agent children away from their parent", () => {
    store({ "a:t1": "s1" });
    render(
      <Sidebar
        {...sectioned({
          threadsByWorkspace: {
            a: [
              { id: "t1", name: "Plan the launch", updatedAt: 20 },
              { id: "kid", name: "Helper", updatedAt: 19, isSubagent: true },
            ],
          },
          threadParentById: { kid: "t1" },
        })}
      />,
    );
    const filed = document.querySelector(".section-thread-list") as HTMLElement;
    expect(within(filed).getByText("Helper")).toBeTruthy();
    const card = screen.getByRole("button", { name: "Alpha" }).closest(".workspace-card") as HTMLElement;
    expect(within(card).queryByText("Helper")).toBeNull();
  });
});

describe("unread chats", () => {
  it("shows the unread indicator for a chat marked unread", () => {
    const alpha = project("a", "Alpha");
    render(
      <Sidebar
        {...baseProps}
        workspaces={[alpha]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [alpha] }]}
        threadsByWorkspace={{ a: [{ id: "t1", name: "Plan", updatedAt: 1 }] }}
        threadStatusById={{ t1: { hasUnread: true } }}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" }).querySelector(".thread-status.unread")).toBeTruthy();
  });

  it("offers Mark as unread and reports the ids", () => {
    const alpha = project("a", "Alpha");
    const onSetThreadUnread = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        workspaces={[alpha]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [alpha] }]}
        threadsByWorkspace={{ a: [{ id: "t1", name: "Plan", updatedAt: 1 }] }}
        onSetThreadUnread={onSetThreadUnread}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Plan" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }));
    expect(onSetThreadUnread).toHaveBeenCalledWith("a", "t1", true);
  });
});
