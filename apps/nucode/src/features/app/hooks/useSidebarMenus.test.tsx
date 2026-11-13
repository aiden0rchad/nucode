/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationItem, ThreadSummary, WorkspaceInfo } from "../../../types";
import { useSidebarMenus, type SidebarMenuHandlers } from "./useSidebarMenus";
import { fileManagerName, revealInFileManagerLabel } from "../../../utils/platformPaths";
import { formatShortcut } from "../../../utils/shortcuts";

const revealItemInDir = vi.hoisted(() => vi.fn());
const ask = vi.hoisted(() => vi.fn());
const openCheckpoints = vi.hoisted(() => vi.fn());
const exportMarkdownFile = vi.hoisted(() => vi.fn());
const openThreadWindow = vi.hoisted(() => vi.fn());
const pushErrorToast = vi.hoisted(() => vi.fn());
const pushInfoToast = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (...args: unknown[]) => revealItemInDir(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => ask(...args),
}));
vi.mock("@services/events", () => ({
  openCheckpoints: (...args: unknown[]) => openCheckpoints(...args),
}));
vi.mock("../../../services/tauri", () => ({
  exportMarkdownFile: (...args: unknown[]) => exportMarkdownFile(...args),
  openThreadWindow: (...args: unknown[]) => openThreadWindow(...args),
}));
vi.mock("../../../services/toasts", () => ({
  pushErrorToast: (...args: unknown[]) => pushErrorToast(...args),
  pushInfoToast: (...args: unknown[]) => pushInfoToast(...args),
}));

const writeText = vi.fn();

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function workspace(id: string, patch: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id,
    name: `Project ${id}`,
    path: `/tmp/${id}`,
    connected: true,
    kind: "main",
    settings: { sidebarCollapsed: false },
    ...patch,
  } as WorkspaceInfo;
}

const thread = (id: string, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  name: `Thread ${id}`,
  updatedAt: 1,
  ...patch,
});

const messages: ConversationItem[] = [
  { id: "m1", kind: "message", role: "user", text: "Hello" },
  { id: "m2", kind: "message", role: "assistant", text: "Hi there" },
];

function makeHandlers(patch: Partial<SidebarMenuHandlers> = {}): SidebarMenuHandlers {
  return {
    onDeleteThread: vi.fn(),
    onSyncThread: vi.fn(),
    onPinThread: vi.fn(),
    onUnpinThread: vi.fn(),
    isThreadPinned: vi.fn(() => false),
    onRenameThread: vi.fn(),
    onReloadWorkspaceThreads: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onDeleteWorktree: vi.fn(),
    workspaces: [workspace("p1")],
    threadsByWorkspace: { p1: [thread("t1"), thread("t2")] },
    sections: [
      { id: "s1", name: "Work" },
      { id: "s2", name: "Home" },
    ],
    onCreateSection: vi.fn(async () => "s-new"),
    isProjectPinned: vi.fn(() => false),
    onPinProject: vi.fn(),
    onUnpinProject: vi.fn(),
    onEditProject: vi.fn(),
    onAssignProjectSection: vi.fn(),
    getThreadSection: vi.fn(() => null),
    onSetThreadSection: vi.fn(),
    onSetThreadUnread: vi.fn(),
    onForkThread: vi.fn(),
    loadThreadItems: vi.fn(async () => messages),
    ...patch,
  };
}

type Target =
  | { kind: "project"; id?: string }
  | { kind: "thread"; workspaceId?: string; threadId?: string; canPin?: boolean }
  | { kind: "worktree"; entry: WorkspaceInfo }
  | { kind: "clone"; entry: WorkspaceInfo }
  | { kind: "section"; id?: string; name?: string };

function Harness({ handlers, targets }: { handlers: SidebarMenuHandlers; targets: Record<string, Target> }) {
  const { showThreadMenu, showWorkspaceMenu, showSectionMenu, showWorktreeMenu, showCloneMenu, menu } =
    useSidebarMenus(handlers);
  return (
    <div>
      {Object.entries(targets).map(([key, target]) => (
        <div
          key={key}
          className="thread-row"
          tabIndex={0}
          data-testid={key}
          onContextMenu={(event) => {
            if (target.kind === "project") showWorkspaceMenu(event, target.id ?? "p1");
            else if (target.kind === "thread")
              showThreadMenu(event, target.workspaceId ?? "p1", target.threadId ?? "t1", target.canPin ?? true);
            else if (target.kind === "worktree") showWorktreeMenu(event, target.entry);
            else if (target.kind === "section")
              showSectionMenu(event, { id: target.id ?? "s1", name: target.name ?? "Work" });
            else showCloneMenu(event, target.entry);
          }}
        >
          {key}
        </div>
      ))}
      {menu}
    </div>
  );
}

function openMenu(handlers: SidebarMenuHandlers, target: Target, key = "row") {
  render(<Harness handlers={handlers} targets={{ [key]: target }} />);
  const row = screen.getByTestId(key);
  fireEvent.contextMenu(row, { clientX: 40, clientY: 50 });
  return row;
}

const labels = (menu: HTMLElement) =>
  Array.from(menu.querySelectorAll("[role=menuitem], [role=menuitemcheckbox], [role=separator]"))
    .map((node) => (node.getAttribute("role") === "separator" ? "---" : node.textContent));

function chooseFromSubmenu(parent: RegExp | string, child: RegExp | string) {
  const parentRow = screen.getByRole("menuitem", { name: parent });
  fireEvent.keyDown(parentRow, { key: "ArrowRight" });
  const submenu = screen.getAllByRole("menu")[1];
  const row = within(submenu).queryByRole("menuitem", { name: child }) ?? within(submenu).getByRole("menuitemcheckbox", { name: child });
  fireEvent.click(row);
}

describe("project menu", () => {
  it("lists the items in order", () => {
    openMenu(makeHandlers(), { kind: "project" });
    expect(labels(screen.getByRole("menu"))).toEqual([
      "Pin",
      "Edit",
      "Section",
      revealInFileManagerLabel(),
      "---",
      "Archive chats",
      "---",
      "Remove project",
    ]);
  });

  it("pins and unpins", () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "project" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(handlers.onPinProject).toHaveBeenCalledWith("p1");
    cleanup();

    const pinned = makeHandlers({ isProjectPinned: vi.fn(() => true) });
    openMenu(pinned, { kind: "project" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin" }));
    expect(pinned.onUnpinProject).toHaveBeenCalledWith("p1");
  });

  it("opens the project settings from Edit", () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "project" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(handlers.onEditProject).toHaveBeenCalledWith("p1");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("assigns a section, marks the current one, and offers No section only when filed", () => {
    const filed = () =>
      makeHandlers({
        workspaces: [workspace("p1", { settings: { sidebarCollapsed: false, groupId: "s2" } })],
      });
    const handlers = filed();
    openMenu(handlers, { kind: "project" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    const submenu = screen.getAllByRole("menu")[1];
    expect(within(submenu).getByRole("menuitemcheckbox", { name: "Home" }).getAttribute("aria-checked")).toBe("true");
    expect(within(submenu).getByRole("menuitemcheckbox", { name: "Work" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(within(submenu).getByRole("menuitemcheckbox", { name: "Work" }));
    expect(handlers.onAssignProjectSection).toHaveBeenCalledWith("p1", "s1");
    cleanup();

    const again = filed();
    openMenu(again, { kind: "project" });
    chooseFromSubmenu("Section", "No section");
    expect(again.onAssignProjectSection).toHaveBeenCalledWith("p1", null);
    cleanup();

    openMenu(makeHandlers(), { kind: "project" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    expect(screen.queryByRole("menuitem", { name: "No section" })).toBeNull();
  });

  it("creates a section from the name field and files the project under it", async () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "project" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    const input = screen.getByPlaceholderText("New section…");
    fireEvent.change(input, { target: { value: "Side projects" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(handlers.onAssignProjectSection).toHaveBeenCalledWith("p1", "s-new"));
    expect(handlers.onCreateSection).toHaveBeenCalledWith("Side projects");
  });

  it("reveals the project folder", async () => {
    openMenu(makeHandlers(), { kind: "project" });
    fireEvent.click(screen.getByRole("menuitem", { name: revealInFileManagerLabel() }));
    await waitFor(() => expect(revealItemInDir).toHaveBeenCalledWith("/tmp/p1"));
  });

  it("archives every chat of the project after a confirmation that states the count", async () => {
    ask.mockResolvedValue(true);
    const handlers = makeHandlers({
      threadsByWorkspace: {
        p1: [thread("t1"), thread("t2"), thread("sub", { isSubagent: true })],
      },
      threadParentById: { sub: "t1" },
    });
    openMenu(handlers, { kind: "project" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive chats" }));
    await waitFor(() => expect(handlers.onDeleteThread).toHaveBeenCalledTimes(2));
    expect(ask.mock.calls[0][0]).toContain("Archive 2 chats");
    expect(handlers.onDeleteThread).toHaveBeenCalledWith("p1", "t1");
    expect(handlers.onDeleteThread).toHaveBeenCalledWith("p1", "t2");
  });

  it("archives nothing when the confirmation is declined", async () => {
    ask.mockResolvedValue(false);
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "project" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive chats" }));
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(handlers.onDeleteThread).not.toHaveBeenCalled();
  });

  it("disables Archive chats for a project without chats", () => {
    openMenu(makeHandlers({ threadsByWorkspace: { p1: [] } }), { kind: "project" });
    const row = screen.getByRole("menuitem", { name: "Archive chats" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("title")).toBeTruthy();
    fireEvent.click(row);
    expect(ask).not.toHaveBeenCalled();
  });

  it("removes the project", () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "project" });
    const remove = screen.getByRole("menuitem", { name: "Remove project" });
    expect(remove.className).toContain("is-danger");
    fireEvent.click(remove);
    expect(handlers.onDeleteWorkspace).toHaveBeenCalledWith("p1");
  });
});

describe("thread menu", () => {
  it("lists the items in order", () => {
    openMenu(makeHandlers(), { kind: "thread" });
    expect(labels(screen.getByRole("menu"))).toEqual([
      "Rename",
      "Pin",
      "Mark as unread",
      "---",
      "Section",
      "Fork",
      "Checkpoints…",
      "---",
      "Share…",
      "Copy",
      "Open in new window",
      "---",
      "Archive",
    ]);
  });

  it("opens the thread in its own window with its ids and name", () => {
    openThreadWindow.mockResolvedValue(undefined);
    openMenu(makeHandlers(), { kind: "thread", threadId: "t2" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in new window" }));
    expect(openThreadWindow).toHaveBeenCalledWith("p1", "t2", "Thread t2");
  });

  it("reports a window that could not open", async () => {
    openThreadWindow.mockRejectedValue(new Error("no window"));
    openMenu(makeHandlers(), { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in new window" }));
    await waitFor(() => expect(pushErrorToast).toHaveBeenCalledWith(expect.objectContaining({ message: "no window" })));
  });

  it("keeps Open in new window off in Remote mode and says why", () => {
    openMenu(makeHandlers({ backendMode: "remote" }), { kind: "thread" });
    const item = screen.getByRole("menuitem", { name: "Open in new window" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.getAttribute("title")).toBe("Not available in Remote mode");
    fireEvent.click(item);
    expect(openThreadWindow).not.toHaveBeenCalled();
  });

  it("calls rename, pin, archive and checkpoints with the thread ids", () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(handlers.onRenameThread).toHaveBeenCalledWith("p1", "t1");
    cleanup();

    openMenu(handlers, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(handlers.onPinThread).toHaveBeenCalledWith("p1", "t1");
    cleanup();

    openMenu(handlers, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Checkpoints…" }));
    expect(openCheckpoints).toHaveBeenCalledWith({ workspaceId: "p1", threadId: "t1" });
    cleanup();

    openMenu(handlers, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(handlers.onDeleteThread).toHaveBeenCalledWith("p1", "t1");
  });

  it("unpins a pinned thread and hides pinning where it is not allowed", () => {
    const handlers = makeHandlers({ isThreadPinned: vi.fn(() => true) });
    openMenu(handlers, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin" }));
    expect(handlers.onUnpinThread).toHaveBeenCalledWith("p1", "t1");
    cleanup();

    openMenu(makeHandlers(), { kind: "thread", canPin: false });
    expect(screen.queryByRole("menuitem", { name: "Pin" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Section" })).toBeNull();
  });

  it("marks a thread unread, or read when it already is", () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }));
    expect(handlers.onSetThreadUnread).toHaveBeenCalledWith("p1", "t1", true);
    cleanup();

    const unread = makeHandlers({ threadStatusById: { t1: { hasUnread: true } } });
    openMenu(unread, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
    expect(unread.onSetThreadUnread).toHaveBeenCalledWith("p1", "t1", false);
  });

  it("files a chat under a section, removes it, and creates a new one", async () => {
    const handlers = makeHandlers({ getThreadSection: vi.fn(() => "s1") });
    openMenu(handlers, { kind: "thread" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    const submenu = screen.getAllByRole("menu")[1];
    expect(within(submenu).getByRole("menuitemcheckbox", { name: "Work" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(submenu).getByRole("menuitemcheckbox", { name: "Home" }));
    expect(handlers.onSetThreadSection).toHaveBeenCalledWith("p1", "t1", "s2");
    cleanup();

    openMenu(handlers, { kind: "thread" });
    chooseFromSubmenu("Section", "No section");
    expect(handlers.onSetThreadSection).toHaveBeenCalledWith("p1", "t1", null);
    cleanup();

    openMenu(handlers, { kind: "thread" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    const input = screen.getByPlaceholderText("New section…");
    fireEvent.change(input, { target: { value: "Later" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(handlers.onSetThreadSection).toHaveBeenCalledWith("p1", "t1", "s-new"));
  });

  it("treats a stored section that no longer exists as none", () => {
    openMenu(makeHandlers({ getThreadSection: vi.fn(() => "gone") }), { kind: "thread" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    const submenu = screen.getAllByRole("menu")[1];
    expect(within(submenu).queryByRole("menuitem", { name: "No section" })).toBeNull();
    for (const row of within(submenu).getAllByRole("menuitemcheckbox")) {
      expect(row.getAttribute("aria-checked")).toBe("false");
    }
  });

  it("does not offer Section for sub-agent threads or threads of worktrees and clones", () => {
    openMenu(
      makeHandlers({
        threadsByWorkspace: { p1: [thread("sub", { isSubagent: true })] },
      }),
      { kind: "thread", threadId: "sub" },
    );
    expect(screen.queryByRole("menuitem", { name: "Section" })).toBeNull();
    cleanup();

    openMenu(
      makeHandlers({
        workspaces: [workspace("w1", { kind: "worktree", parentId: "p1" })],
        threadsByWorkspace: { w1: [thread("t1")] },
      }),
      { kind: "thread", workspaceId: "w1" },
    );
    expect(screen.queryByRole("menuitem", { name: "Section" })).toBeNull();
    cleanup();

    openMenu(
      makeHandlers({
        workspaces: [workspace("c1", { settings: { sidebarCollapsed: false, cloneSourceWorkspaceId: "p1" } })],
        threadsByWorkspace: { c1: [thread("t1")] },
      }),
      { kind: "thread", workspaceId: "c1" },
    );
    expect(screen.queryByRole("menuitem", { name: "Section" })).toBeNull();
  });

  it("forks in this project", () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "thread" });
    chooseFromSubmenu("Fork", "Fork in this project");
    expect(handlers.onForkThread).toHaveBeenCalledWith("p1", "t1");
  });

  it("disables the fork row for an engine that cannot fork", () => {
    openMenu(
      makeHandlers({
        threadsByWorkspace: { p1: [thread("t1", { engine: "claude" })] },
      }),
      { kind: "thread" },
    );
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Fork" }), { key: "ArrowRight" });
    expect(screen.getByRole("menuitem", { name: "Fork in this project" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("shares the transcript of a thread that is not open through the export dialog", async () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Share…" }));
    await waitFor(() => expect(exportMarkdownFile).toHaveBeenCalled());
    expect(handlers.loadThreadItems).toHaveBeenCalledWith("p1", "t1");
    expect(exportMarkdownFile.mock.calls[0][0]).toBe("User: Hello\n\nAssistant: Hi there");
    expect(exportMarkdownFile.mock.calls[0][1]).toBe("thread-t1.md");
  });

  it("copies the transcript, the working directory and the session id", async () => {
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "thread" });
    chooseFromSubmenu("Copy", "Copy as Markdown");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("User: Hello\n\nAssistant: Hi there"));
    cleanup();

    openMenu(handlers, { kind: "thread" });
    chooseFromSubmenu("Copy", "Copy working directory");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/tmp/p1"));
    cleanup();

    openMenu(handlers, { kind: "thread" });
    chooseFromSubmenu("Copy", "Copy session ID");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("t1"));
  });

  it("reports an empty chat instead of exporting nothing", async () => {
    openMenu(makeHandlers({ loadThreadItems: vi.fn(async () => []) }), { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Share…" }));
    await waitFor(() => expect(pushErrorToast).toHaveBeenCalled());
    expect(exportMarkdownFile).not.toHaveBeenCalled();
  });

  it("passes no shortcut hints in this part", () => {
    openMenu(makeHandlers(), { kind: "thread" });
    expect(document.querySelectorAll(".ctx-shortcut")).toHaveLength(0);
  });
});

describe("worktree and clone menus", () => {
  it("shows the worktree in the file manager", async () => {
    const entry = workspace("worktree-1", {
      name: "feature/test",
      path: "/tmp/worktree-1",
      kind: "worktree",
      worktree: { branch: "feature/test" },
    });
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "worktree", entry });
    expect(labels(screen.getByRole("menu"))).toEqual([
      "Reload threads",
      `Show in ${fileManagerName()}`,
      "Delete worktree",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: `Show in ${fileManagerName()}` }));
    await waitFor(() => expect(revealItemInDir).toHaveBeenCalledWith("/tmp/worktree-1"));
    cleanup();

    openMenu(handlers, { kind: "worktree", entry });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete worktree" }));
    expect(handlers.onDeleteWorktree).toHaveBeenCalledWith("worktree-1");
    cleanup();

    openMenu(handlers, { kind: "worktree", entry });
    fireEvent.click(screen.getByRole("menuitem", { name: "Reload threads" }));
    expect(handlers.onReloadWorkspaceThreads).toHaveBeenCalledWith("worktree-1");
  });

  it("deletes a clone through the workspace handler", () => {
    const entry = workspace("clone-1", { path: "/tmp/clone-1" });
    const handlers = makeHandlers();
    openMenu(handlers, { kind: "clone", entry });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete clone" }));
    expect(handlers.onDeleteWorkspace).toHaveBeenCalledWith("clone-1");
  });
});

describe("section menu", () => {
  const sectionHandlers = (patch: Partial<SidebarMenuHandlers> = {}) =>
    makeHandlers({ onRenameSection: vi.fn(async () => true), onDeleteSection: vi.fn(async () => true), ...patch });

  it("renames from a field that starts with the current name", async () => {
    const handlers = sectionHandlers();
    openMenu(handlers, { kind: "section" });
    expect(labels(screen.getByRole("menu"))).toEqual(["---", "Delete section"]);
    const input = screen.getByRole("textbox", { name: "Rename section" }) as HTMLInputElement;
    expect(input.value).toBe("Work");
    fireEvent.change(input, { target: { value: "Clients" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(handlers.onRenameSection).toHaveBeenCalledWith("s1", "Clients"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves an unchanged name alone", async () => {
    const handlers = sectionHandlers();
    openMenu(handlers, { kind: "section" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename section" }), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(handlers.onRenameSection).not.toHaveBeenCalled();
  });

  it("says why a rename failed", async () => {
    const handlers = sectionHandlers({
      onRenameSection: vi.fn(async () => {
        throw new Error("A section with that name already exists.");
      }),
    });
    openMenu(handlers, { kind: "section" });
    const input = screen.getByRole("textbox", { name: "Rename section" });
    fireEvent.change(input, { target: { value: "Home" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(pushErrorToast).toHaveBeenCalledWith({
        title: "Couldn't rename section",
        message: "A section with that name already exists.",
      }),
    );
  });

  it("deletes only after the confirmation, which names the section", async () => {
    ask.mockResolvedValue(false);
    const declined = sectionHandlers();
    openMenu(declined, { kind: "section" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete section" }));
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(ask.mock.calls[0][0]).toContain('"Work"');
    expect(declined.onDeleteSection).not.toHaveBeenCalled();
    cleanup();

    ask.mockResolvedValue(true);
    const confirmed = sectionHandlers();
    openMenu(confirmed, { kind: "section" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete section" }));
    await waitFor(() => expect(confirmed.onDeleteSection).toHaveBeenCalledWith("s1"));
  });
});

describe("menu lifecycle", () => {
  it("keeps one menu open at a time and marks the owning row while it is open", () => {
    const handlers = makeHandlers();
    render(
      <Harness
        handlers={handlers}
        targets={{ first: { kind: "thread", threadId: "t1" }, second: { kind: "thread", threadId: "t2" } }}
      />,
    );
    const first = screen.getByTestId("first");
    const second = screen.getByTestId("second");
    fireEvent.contextMenu(first, { clientX: 5, clientY: 5 });
    expect(first.hasAttribute("data-context-open")).toBe(true);
    fireEvent.contextMenu(second, { clientX: 9, clientY: 9 });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(first.hasAttribute("data-context-open")).toBe(false);
    expect(second.hasAttribute("data-context-open")).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(handlers.onRenameThread).toHaveBeenCalledWith("p1", "t2");
    expect(second.hasAttribute("data-context-open")).toBe(false);
  });

  it("returns focus to the row on Escape", () => {
    const row = openMenu(makeHandlers(), { kind: "thread" });
    expect(document.activeElement).toBe(screen.getByRole("menu"));
    act(() => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row);
  });
});

describe("backend thread items", () => {
  const projects = () => [workspace("p1"), workspace("p2", { name: "Second" }), workspace("w1", { kind: "worktree", parentId: "p1" }),
    workspace("c1", { settings: { sidebarCollapsed: false, cloneSourceWorkspaceId: "p1" } })];
  const backend = (patch: Partial<SidebarMenuHandlers> = {}) =>
    makeHandlers({
      workspaces: projects(),
      threadsByWorkspace: { p1: [thread("t1", { engine: "pi" })] },
      onMoveThread: vi.fn(async () => true),
      onDeleteThreadPermanently: vi.fn(async () => true),
      onForkIntoWorktree: vi.fn(),
      onSelectThread: vi.fn(),
      ...patch,
    });

  it("lists the other top-level projects, checks and disables the current one, and moves on choice", async () => {
    const handlers = backend();
    openMenu(handlers, { kind: "thread" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Project" }), { key: "ArrowRight" });
    const submenu = screen.getAllByRole("menu")[1];
    const rows = Array.from(submenu.querySelectorAll("[role=menuitem], [role=menuitemcheckbox]")).map((node) => node.textContent);
    expect(rows).toEqual(["Project p1", "Second"]);
    const current = within(submenu).getByRole("menuitemcheckbox", { name: "Project p1" });
    expect(current.getAttribute("aria-checked")).toBe("true");
    expect(current.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(submenu).getByRole("menuitem", { name: "Second" }));
    await waitFor(() => expect(handlers.onSelectThread).toHaveBeenCalledWith("p2", "t1"));
    expect(handlers.onMoveThread).toHaveBeenCalledWith("p1", "t1", "p2");
    expect(pushInfoToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Moved to Second" }));
  });

  it("does not select or announce a move that failed", async () => {
    const handlers = backend({ onMoveThread: vi.fn(async () => false) });
    openMenu(handlers, { kind: "thread" });
    chooseFromSubmenu("Project", "Second");
    await waitFor(() => expect(handlers.onMoveThread).toHaveBeenCalled());
    expect(handlers.onSelectThread).not.toHaveBeenCalled();
    expect(pushInfoToast).not.toHaveBeenCalled();
  });

  it.each([
    ["a running thread", { threadStatusById: { t1: { isProcessing: true } } }, {}, "Finish or interrupt"],
    ["a sub-agent thread", { threadsByWorkspace: { p1: [thread("t1", { engine: "pi", isSubagent: true })] } }, {}, "move with their parent"],
    ["a codex thread", { threadsByWorkspace: { p1: [thread("t1", { engine: "codex" })] } }, {}, "pi and omp"],
    ["a claude thread", { threadsByWorkspace: { p1: [thread("t1", { engine: "claude" })] } }, {}, "pi and omp"],
    ["a worktree thread", { workspaces: projects(), threadsByWorkspace: { w1: [thread("t1", { engine: "pi" })] } }, { workspaceId: "w1" }, "worktrees and clones"],
    ["no other project", { workspaces: [workspace("p1")] }, {}, "no other project"],
  ] as const)("disables Project for %s with a reason", (_name, patch, target, reason) => {
    const handlers = backend(patch as Partial<SidebarMenuHandlers>);
    openMenu(handlers, { kind: "thread", ...target });
    const row = screen.getByRole("menuitem", { name: "Project" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("title")).toContain(reason);
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(handlers.onMoveThread).not.toHaveBeenCalled();
  });

  it("forks into a new worktree through the existing prompt, unless worktrees are off or the row is a worktree", () => {
    const handlers = backend();
    openMenu(handlers, { kind: "thread" });
    chooseFromSubmenu("Fork", "Fork into a new worktree");
    expect(handlers.onForkIntoWorktree).toHaveBeenCalledWith("p1", "t1");
    cleanup();

    const off = backend({ canForkIntoWorktree: false });
    openMenu(off, { kind: "thread" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Fork" }), { key: "ArrowRight" });
    const row = screen.getByRole("menuitem", { name: "Fork into a new worktree" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("title")).toBeTruthy();
    cleanup();

    const inWorktree = backend({ threadsByWorkspace: { w1: [thread("t1", { engine: "pi" })] } });
    openMenu(inWorktree, { kind: "thread", workspaceId: "w1" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Fork" }), { key: "ArrowRight" });
    expect(screen.getByRole("menuitem", { name: "Fork into a new worktree" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("gives both fork rows an icon so their labels line up", () => {
    openMenu(backend(), { kind: "thread" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Fork" }), { key: "ArrowRight" });
    for (const name of ["Fork in this project", "Fork into a new worktree"]) {
      expect(screen.getByRole("menuitem", { name }).querySelector(".ctx-icon svg")).toBeTruthy();
    }
  });

  it("puts Permanently delete last, under Archive, and asks naming the thread before deleting", async () => {
    ask.mockResolvedValue(true);
    const handlers = backend();
    openMenu(handlers, { kind: "thread" });
    const all = labels(screen.getByRole("menu"));
    expect(all.slice(-3)).toEqual(["Archive", "---", "Permanently delete"]);
    const remove = screen.getByRole("menuitem", { name: "Permanently delete" });
    expect(remove.className).toContain("is-danger");
    fireEvent.click(remove);
    await waitFor(() => expect(handlers.onDeleteThreadPermanently).toHaveBeenCalledWith("p1", "t1"));
    expect(ask.mock.calls[0][0]).toContain("Thread t1");
    expect(ask.mock.calls[0][0]).toContain("cannot be undone");
  });

  it("deletes nothing when the confirmation is declined", async () => {
    ask.mockResolvedValue(false);
    const handlers = backend();
    openMenu(handlers, { kind: "thread" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Permanently delete" }));
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(handlers.onDeleteThreadPermanently).not.toHaveBeenCalled();
  });

  it.each([
    ["a running thread", { threadStatusById: { t1: { isProcessing: true } } }, "Finish or interrupt"],
    ["a codex thread", { threadsByWorkspace: { p1: [thread("t1", { engine: "codex" })] } }, "Codex"],
  ] as const)("disables Permanently delete for %s", (_name, patch, reason) => {
    const handlers = backend(patch as Partial<SidebarMenuHandlers>);
    openMenu(handlers, { kind: "thread" });
    const row = screen.getByRole("menuitem", { name: "Permanently delete" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("title")).toContain(reason);
    fireEvent.click(row);
    expect(ask).not.toHaveBeenCalled();
  });

  it("reports how many chats were archived and how many failed", async () => {
    ask.mockResolvedValue(true);
    const onDeleteThread = vi.fn(async (_workspaceId: string, threadId: string) => threadId !== "t2");
    openMenu(makeHandlers({ onDeleteThread }), { kind: "project" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive chats" }));
    await waitFor(() => expect(pushErrorToast).toHaveBeenCalled());
    expect(pushErrorToast.mock.calls[0][0].title).toBe("Archived 1 chat, 1 failed");
    expect(pushInfoToast).not.toHaveBeenCalled();
  });

  it("reports a clean archive of every chat", async () => {
    ask.mockResolvedValue(true);
    openMenu(makeHandlers({ onDeleteThread: vi.fn(async () => true) }), { kind: "project" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive chats" }));
    await waitFor(() => expect(pushInfoToast).toHaveBeenCalled());
    expect(pushInfoToast.mock.calls[0][0].title).toBe("Archived 2 chats");
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("shows hints for Rename, Pin, Mark as unread and Archive, and none for a cleared shortcut", () => {
    const handlers = backend({
      shortcuts: { rename: "cmd+alt+r", pin: "cmd+alt+p", markUnread: "cmd+shift+u", archive: "cmd+ctrl+a" },
    });
    openMenu(handlers, { kind: "thread" });
    const hintOf = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) }).querySelector(".ctx-shortcut")?.textContent;
    expect(hintOf("Rename")).toBe(formatShortcut("cmd+alt+r"));
    expect(hintOf("Pin")).toBe(formatShortcut("cmd+alt+p"));
    expect(hintOf("Mark as unread")).toBe(formatShortcut("cmd+shift+u"));
    expect(hintOf("Archive")).toBe(formatShortcut("cmd+ctrl+a"));
    expect(document.querySelectorAll(".ctx-shortcut")).toHaveLength(4);
    cleanup();

    openMenu(backend({ shortcuts: { rename: null, pin: "", markUnread: undefined, archive: "cmd+ctrl+a" } }), { kind: "thread" });
    expect(document.querySelectorAll(".ctx-shortcut")).toHaveLength(1);
  });
});
