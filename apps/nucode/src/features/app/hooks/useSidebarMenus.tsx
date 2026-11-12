import { openCheckpoints } from "@services/events";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import Archive from "lucide-react/dist/esm/icons/archive";
import ArrowRightLeft from "lucide-react/dist/esm/icons/arrow-right-left";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import TrashPermanent from "lucide-react/dist/esm/icons/trash-2";
import Copy from "lucide-react/dist/esm/icons/copy";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import GitFork from "lucide-react/dist/esm/icons/git-fork";
import History from "lucide-react/dist/esm/icons/history";
import Layers2 from "lucide-react/dist/esm/icons/layers-2";
import Mail from "lucide-react/dist/esm/icons/mail";
import MailOpen from "lucide-react/dist/esm/icons/mail-open";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Pin from "lucide-react/dist/esm/icons/pin";
import PinOff from "lucide-react/dist/esm/icons/pin-off";
import Plus from "lucide-react/dist/esm/icons/plus";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw";
import Share2 from "lucide-react/dist/esm/icons/share-2";
import SquarePen from "lucide-react/dist/esm/icons/square-pen";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";

import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuSubmenuItem,
} from "../../design-system/components/menu/ContextMenu";
import { engineCapabilities } from "../../threads/utils/engineCapabilities";
import type { ConversationItem, ThreadSummary, WorkspaceInfo } from "../../../types";
import { exportMarkdownFile } from "../../../services/tauri";
import { pushErrorToast, pushInfoToast } from "../../../services/toasts";
import {
  fileManagerName,
  revealInFileManagerLabel,
} from "../../../utils/platformPaths";
import type { ThreadStatusById } from "../../../utils/threadStatus";
import { formatShortcut } from "../../../utils/shortcuts";
import { buildThreadTranscript } from "../../../utils/threadText";

export type SidebarSection = { id: string; name: string };

/** Raw shortcut strings; a missing or cleared one shows no hint. */
export type SidebarMenuShortcuts = {
  rename?: string | null;
  pin?: string | null;
  markUnread?: string | null;
  archive?: string | null;
};

const MOVABLE_ENGINES = new Set(["pi", "omp"]);
const RUNNING_REASON = "Finish or interrupt the turn first";

export type SidebarMenuHandlers = {
  /** Resolves to false when the backend refused (the row is restored); void callers count as success. */
  onDeleteThread: (workspaceId: string, threadId: string) => void | Promise<boolean>;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  onPinThread: (workspaceId: string, threadId: string) => void;
  onUnpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  /** Used to resolve project paths and which rows may be filed under a section. */
  workspaces?: WorkspaceInfo[];
  threadsByWorkspace?: Record<string, ThreadSummary[]>;
  threadParentById?: Record<string, string>;
  threadStatusById?: ThreadStatusById;
  /** Sections a project or chat can be filed under, in display order. */
  sections?: SidebarSection[];
  onCreateSection?: (name: string) => Promise<string | null>;
  isProjectPinned?: (workspaceId: string) => boolean;
  onPinProject?: (workspaceId: string) => void;
  onUnpinProject?: (workspaceId: string) => void;
  onEditProject?: (workspaceId: string) => void;
  onAssignProjectSection?: (workspaceId: string, sectionId: string | null) => void;
  getThreadSection?: (workspaceId: string, threadId: string) => string | null;
  onSetThreadSection?: (workspaceId: string, threadId: string, sectionId: string | null) => void;
  onSetThreadUnread?: (workspaceId: string, threadId: string, unread: boolean) => void;
  onForkThread?: (workspaceId: string, threadId: string) => void;
  /** Loads a thread's items without switching the visible thread. */
  loadThreadItems?: (workspaceId: string, threadId: string) => Promise<ConversationItem[]>;
  onMoveThread?: (workspaceId: string, threadId: string, targetWorkspaceId: string) => Promise<boolean>;
  onDeleteThreadPermanently?: (workspaceId: string, threadId: string) => Promise<boolean>;
  onForkIntoWorktree?: (workspaceId: string, threadId: string) => void;
  /** Whether worktrees are available (the same gate as "New worktree agent"). */
  canForkIntoWorktree?: boolean;
  onSelectThread?: (workspaceId: string, threadId: string) => void;
  shortcuts?: SidebarMenuShortcuts;
};

type OpenMenu = {
  id: number;
  label: string;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  row: HTMLElement | null;
};

const ROW_SELECTOR = ".thread-row, .workspace-row, .worktree-row";

function separator(id: string): ContextMenuItem {
  return { kind: "separator", id };
}

/** Drops missing entries and any separator that would lead, trail or repeat. */
type MenuEntry = ContextMenuItem | null | false | undefined;

function tidy(entries: MenuEntry[]): ContextMenuItem[] {
  const result: ContextMenuItem[] = [];
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    if (entry.kind === "separator" && (result.length === 0 || result[result.length - 1].kind === "separator")) {
      continue;
    }
    result.push(entry);
  }
  while (result.length > 0 && result[result.length - 1].kind === "separator") {
    result.pop();
  }
  return result;
}

function hint(shortcut: string | null | undefined) {
  return shortcut && shortcut.trim() ? formatShortcut(shortcut) : undefined;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

async function revealPath(path: string | null | undefined, what: string, workspaceId: string) {
  if (!path) {
    return;
  }
  const fileManagerLabel = fileManagerName();
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  } catch (error) {
    const message = describeError(error);
    pushErrorToast({ title: `Couldn't show ${what} in ${fileManagerLabel}`, message });
    console.warn(`Failed to reveal ${what}`, { message, workspaceId, path });
  }
}

export function useSidebarMenus({
  onDeleteThread,
  onPinThread,
  onUnpinThread,
  isThreadPinned,
  onRenameThread,
  onReloadWorkspaceThreads,
  onDeleteWorkspace,
  onDeleteWorktree,
  workspaces = [],
  threadsByWorkspace = {},
  threadParentById = {},
  threadStatusById = {},
  sections = [],
  onCreateSection,
  isProjectPinned,
  onPinProject,
  onUnpinProject,
  onEditProject,
  onAssignProjectSection,
  getThreadSection,
  onSetThreadSection,
  onSetThreadUnread,
  onForkThread,
  loadThreadItems,
  onMoveThread,
  onDeleteThreadPermanently,
  onForkIntoWorktree,
  canForkIntoWorktree = true,
  onSelectThread,
  shortcuts = {},
}: SidebarMenuHandlers) {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const nextId = useRef(0);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    const row = open?.row;
    if (!row) {
      return undefined;
    }
    row.setAttribute("data-context-open", "");
    return () => row.removeAttribute("data-context-open");
  }, [open]);

  const show = useCallback(
    (event: MouseEvent, label: string, items: MenuEntry[]) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement | null;
      const row = target?.closest<HTMLElement>(ROW_SELECTOR) ?? target;
      let x = event.clientX;
      let y = event.clientY;
      if (x === 0 && y === 0 && row) {
        // A menu opened from the keyboard has no pointer; anchor it to the row.
        const rect = row.getBoundingClientRect();
        x = rect.left + 24;
        y = rect.bottom - 4;
      }
      nextId.current += 1;
      setOpen({ id: nextId.current, label, position: { x, y }, items: tidy(items), row });
    },
    [],
  );

  const sectionSubmenu = useCallback(
    (
      idPrefix: string,
      currentId: string | null,
      choose: (sectionId: string | null) => void,
    ): ContextMenuSubmenuItem => {
      const currentValid = currentId !== null && sections.some((section) => section.id === currentId);
      const create = async (name: string) => {
        try {
          const id = await onCreateSection?.(name);
          if (id) {
            choose(id);
          }
        } catch (error) {
          pushErrorToast({ title: "Couldn't create section", message: describeError(error) });
        }
      };
      return {
        kind: "submenu",
        id: `${idPrefix}-section`,
        label: "Section",
        icon: <Layers2 size={16} />,
        items: tidy([
          ...sections.map((section): ContextMenuItem => ({
            id: `section:${section.id}`,
            label: section.name,
            checked: section.id === currentId,
            onSelect: () => choose(section.id),
          })),
          currentValid && {
            id: "section:none",
            label: "No section",
            onSelect: () => choose(null),
          },
          (sections.length > 0 || currentValid) && separator("section-sep"),
          onCreateSection && {
            kind: "input",
            id: "section:new",
            label: "New section",
            placeholder: "New section…",
            icon: <Plus size={16} />,
            onSubmit: (name: string) => void create(name),
          },
        ]),
      };
    },
    [onCreateSection, sections],
  );

  const showThreadMenu = useCallback(
    (event: MouseEvent, workspaceId: string, threadId: string, canPin: boolean) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const thread = threadsByWorkspace[workspaceId]?.find((entry) => entry.id === threadId);
      const unread = Boolean(threadStatusById[threadId]?.hasUnread);
      const isPinned = canPin && isThreadPinned(workspaceId, threadId);
      const isClone = Boolean(workspace?.settings.cloneSourceWorkspaceId?.trim());
      const canSection =
        canPin &&
        Boolean(workspace) &&
        (workspace?.kind ?? "main") === "main" &&
        !isClone &&
        !thread?.isSubagent &&
        !thread?.sideOf &&
        !threadParentById[threadId] &&
        Boolean(onSetThreadSection);
      const engine = thread?.engine ?? "codex";
      const forkSupported = thread
        ? engineCapabilities(engine, thread.capabilities).forkLatest
        : true;
      const running = Boolean(threadStatusById[threadId]?.isProcessing);
      const isTopLevelProject = (entry: WorkspaceInfo) =>
        (entry.kind ?? "main") === "main" && !entry.settings.cloneSourceWorkspaceId?.trim();
      const otherProjects = workspaces.filter((entry) => isTopLevelProject(entry) && entry.id !== workspaceId);
      const moveReason = !onMoveThread
        ? undefined
        : running
          ? RUNNING_REASON
          : thread?.isSubagent || thread?.sideOf || threadParentById[threadId]
            ? "Sub-agent and side chats move with their parent"
            : !MOVABLE_ENGINES.has(engine)
              ? "Moving is only available for pi and omp chats"
              : !workspace || !isTopLevelProject(workspace)
                ? "Chats in worktrees and clones stay with them"
                : otherProjects.length === 0
                  ? "There is no other project to move to"
                  : undefined;
      const moveTo = async (target: WorkspaceInfo) => {
        if (await onMoveThread?.(workspaceId, threadId, target.id)) {
          onSelectThread?.(target.id, threadId);
          pushInfoToast({ title: `Moved to ${target.name}`, message: thread?.name ?? "The chat was moved." });
        }
      };
      const worktreeReason = !canForkIntoWorktree
        ? "Worktrees are turned off in Settings"
        : !workspace || !isTopLevelProject(workspace)
          ? "Fork from the project's own chat to use a new worktree"
          : undefined;
      const deleteReason = running
        ? RUNNING_REASON
        : engine === "codex"
          ? "Not available for Codex threads"
          : undefined;
      const deletePermanently = async () => {
        let confirmed = false;
        try {
          confirmed = await ask(`Permanently delete "${thread?.name ?? "this chat"}"? This cannot be undone.`, {
            title: "Delete chat",
            kind: "warning",
            okLabel: "Delete",
          });
        } catch (error) {
          pushErrorToast({ title: "Couldn't delete chat", message: describeError(error) });
          return;
        }
        if (confirmed) {
          await onDeleteThreadPermanently?.(workspaceId, threadId);
        }
      };
      const withItems = async (use: (items: ConversationItem[]) => Promise<void>, what: string) => {
        try {
          const items = loadThreadItems ? await loadThreadItems(workspaceId, threadId) : [];
          if (buildThreadTranscript(items).trim().length === 0) {
            pushErrorToast({ title: `Couldn't ${what}`, message: "This chat has no messages yet." });
            return;
          }
          await use(items);
        } catch (error) {
          pushErrorToast({ title: `Couldn't ${what}`, message: describeError(error) });
        }
      };
      const writeClipboard = async (text: string, what: string) => {
        try {
          await navigator.clipboard.writeText(text);
        } catch (error) {
          pushErrorToast({ title: `Couldn't ${what}`, message: describeError(error) });
        }
      };

      show(event, thread?.name ?? "Chat actions", [
        {
          id: "rename",
          label: "Rename",
          icon: <Pencil size={16} />,
          shortcut: hint(shortcuts.rename),
          onSelect: () => onRenameThread(workspaceId, threadId),
        },
        canPin && {
          id: "pin",
          label: isPinned ? "Unpin" : "Pin",
          icon: isPinned ? <PinOff size={16} /> : <Pin size={16} />,
          shortcut: hint(shortcuts.pin),
          onSelect: () => (isPinned ? onUnpinThread(workspaceId, threadId) : onPinThread(workspaceId, threadId)),
        },
        onSetThreadUnread && {
          id: "unread",
          label: unread ? "Mark as read" : "Mark as unread",
          icon: unread ? <MailOpen size={16} /> : <Mail size={16} />,
          shortcut: hint(shortcuts.markUnread),
          onSelect: () => onSetThreadUnread(workspaceId, threadId, !unread),
        },
        onMoveThread && {
          kind: "submenu",
          id: "project",
          label: "Project",
          icon: <ArrowRightLeft size={16} />,
          disabled: Boolean(moveReason),
          disabledReason: moveReason,
          items: workspaces.filter(isTopLevelProject).map((entry): ContextMenuItem =>
            entry.id === workspaceId
              ? { id: `project:${entry.id}`, label: entry.name, checked: true, disabled: true, disabledReason: "The chat is already in this project", onSelect: () => {} }
              : { id: `project:${entry.id}`, label: entry.name, onSelect: () => void moveTo(entry) },
          ),
        },
        separator("sep-organize"),
        canSection &&
          sectionSubmenu(
            "thread",
            getThreadSection?.(workspaceId, threadId) ?? null,
            (sectionId) => onSetThreadSection?.(workspaceId, threadId, sectionId),
          ),
        onForkThread && {
          kind: "submenu",
          id: "fork",
          label: "Fork",
          icon: <GitFork size={16} />,
          items: tidy([
            {
              id: "fork-here",
              label: "Fork in this project",
              disabled: !forkSupported,
              disabledReason: "Fork is not supported for this engine",
              onSelect: () => onForkThread(workspaceId, threadId),
            },
            onForkIntoWorktree && {
              id: "fork-worktree",
              label: "Fork into a new worktree",
              icon: <GitBranch size={16} />,
              disabled: Boolean(worktreeReason) || !forkSupported,
              disabledReason: worktreeReason ?? "Fork is not supported for this engine",
              onSelect: () => onForkIntoWorktree(workspaceId, threadId),
            },
          ]),
        },
        {
          id: "checkpoints",
          label: "Checkpoints…",
          icon: <History size={16} />,
          onSelect: () => openCheckpoints({ workspaceId, threadId }),
        },
        separator("sep-share"),
        loadThreadItems && {
          id: "share",
          label: "Share…",
          icon: <Share2 size={16} />,
          onSelect: () =>
            void withItems(async (items) => {
              await exportMarkdownFile(
                buildThreadTranscript(items),
                `${slugify(thread?.name ?? "") || "thread"}.md`,
                "Share chat as Markdown",
              );
            }, "share the chat"),
        },
        {
          kind: "submenu",
          id: "copy",
          label: "Copy",
          icon: <Copy size={16} />,
          items: tidy([
            loadThreadItems && {
              id: "copy-markdown",
              label: "Copy as Markdown",
              onSelect: () =>
                void withItems(
                  (items) => writeClipboard(buildThreadTranscript(items), "copy the chat"),
                  "copy the chat",
                ),
            },
            {
              id: "copy-cwd",
              label: "Copy working directory",
              disabled: !workspace?.path,
              disabledReason: "No working directory for this chat",
              onSelect: () => void writeClipboard(workspace?.path ?? "", "copy the working directory"),
            },
            {
              id: "copy-id",
              label: "Copy session ID",
              onSelect: () => void writeClipboard(threadId, "copy the session ID"),
            },
          ]),
        },
        separator("sep-archive"),
        {
          id: "archive",
          label: "Archive",
          icon: <Archive size={16} />,
          shortcut: hint(shortcuts.archive),
          onSelect: () => void onDeleteThread(workspaceId, threadId),
        },
        onDeleteThreadPermanently && separator("sep-delete"),
        onDeleteThreadPermanently && {
          id: "delete",
          label: "Permanently delete",
          icon: <TrashPermanent size={16} />,
          danger: true,
          disabled: Boolean(deleteReason),
          disabledReason: deleteReason,
          onSelect: () => void deletePermanently(),
        },
      ]);
    },
    [
      getThreadSection,
      isThreadPinned,
      loadThreadItems,
      onDeleteThread,
      onDeleteThreadPermanently,
      onForkIntoWorktree,
      onMoveThread,
      onSelectThread,
      canForkIntoWorktree,
      shortcuts,
      onForkThread,
      onPinThread,
      onRenameThread,
      onSetThreadSection,
      onSetThreadUnread,
      onUnpinThread,
      sectionSubmenu,
      show,
      threadParentById,
      threadStatusById,
      threadsByWorkspace,
      workspaces,
    ],
  );

  const showWorkspaceMenu = useCallback(
    (event: MouseEvent, workspaceId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const pinned = Boolean(isProjectPinned?.(workspaceId));
      const roots = (threadsByWorkspace[workspaceId] ?? []).filter(
        (thread) => !thread.isSubagent && !threadParentById[thread.id],
      );
      const archiveChats = async () => {
        const count = roots.length;
        if (count === 0) {
          return;
        }
        let confirmed = false;
        try {
          confirmed = await ask(
            `Archive ${count} chat${count === 1 ? "" : "s"} in ${workspace?.name ?? "this project"}?`,
            { title: "Archive chats", kind: "warning", okLabel: "Archive" },
          );
        } catch (error) {
          pushErrorToast({ title: "Couldn't archive chats", message: describeError(error) });
          return;
        }
        if (!confirmed) {
          return;
        }
        const results = await Promise.all(
          roots.map(async (thread) => (await onDeleteThread(workspaceId, thread.id)) !== false),
        );
        const failed = results.filter((ok) => !ok).length;
        const archivedCount = results.length - failed;
        if (failed === 0) {
          pushInfoToast({
            title: `Archived ${archivedCount} chat${archivedCount === 1 ? "" : "s"}`,
            message: workspace?.name ?? "The project's chats were archived.",
          });
        } else {
          pushErrorToast({
            title: `Archived ${archivedCount} chat${archivedCount === 1 ? "" : "s"}, ${failed} failed`,
            message: "The chats that failed were put back in the list.",
          });
        }
      };

      show(event, workspace?.name ?? "Project actions", [
        onPinProject &&
          onUnpinProject && {
            id: "pin",
            label: pinned ? "Unpin" : "Pin",
            icon: pinned ? <PinOff size={16} /> : <Pin size={16} />,
            onSelect: () => (pinned ? onUnpinProject(workspaceId) : onPinProject(workspaceId)),
          },
        onEditProject && {
          id: "edit",
          label: "Edit",
          icon: <SquarePen size={16} />,
          onSelect: () => onEditProject(workspaceId),
        },
        onAssignProjectSection &&
          sectionSubmenu(
            "project",
            workspace?.settings.groupId ?? null,
            (sectionId) => onAssignProjectSection(workspaceId, sectionId),
          ),
        {
          id: "reveal",
          label: revealInFileManagerLabel(),
          icon: <FolderOpen size={16} />,
          disabled: !workspace?.path,
          disabledReason: "This project has no folder on disk",
          onSelect: () => void revealPath(workspace?.path, "project", workspaceId),
        },
        separator("sep-archive"),
        {
          id: "archive-chats",
          label: "Archive chats",
          icon: <Archive size={16} />,
          disabled: roots.length === 0,
          disabledReason: "This project has no chats",
          onSelect: () => void archiveChats(),
        },
        separator("sep-remove"),
        {
          id: "remove",
          label: "Remove project",
          icon: <Trash2 size={16} />,
          danger: true,
          onSelect: () => onDeleteWorkspace(workspaceId),
        },
      ]);
    },
    [
      isProjectPinned,
      onAssignProjectSection,
      onDeleteThread,
      onDeleteWorkspace,
      onEditProject,
      onPinProject,
      onUnpinProject,
      sectionSubmenu,
      show,
      threadParentById,
      threadsByWorkspace,
      workspaces,
    ],
  );

  const showSimpleWorkspaceMenu = useCallback(
    (event: MouseEvent, entry: WorkspaceInfo, what: string, remove: () => void) => {
      show(event, entry.name, [
        {
          id: "reload",
          label: "Reload threads",
          icon: <RotateCw size={16} />,
          onSelect: () => onReloadWorkspaceThreads(entry.id),
        },
        {
          id: "reveal",
          label: `Show in ${fileManagerName()}`,
          icon: <FolderOpen size={16} />,
          onSelect: () => void revealPath(entry.path, what, entry.id),
        },
        {
          id: "delete",
          label: `Delete ${what}`,
          icon: <Trash2 size={16} />,
          danger: true,
          onSelect: remove,
        },
      ]);
    },
    [onReloadWorkspaceThreads, show],
  );

  const showWorktreeMenu = useCallback(
    (event: MouseEvent, worktree: WorkspaceInfo) =>
      showSimpleWorkspaceMenu(event, worktree, "worktree", () => onDeleteWorktree(worktree.id)),
    [onDeleteWorktree, showSimpleWorkspaceMenu],
  );

  const showCloneMenu = useCallback(
    (event: MouseEvent, clone: WorkspaceInfo) =>
      showSimpleWorkspaceMenu(event, clone, "clone", () => onDeleteWorkspace(clone.id)),
    [onDeleteWorkspace, showSimpleWorkspaceMenu],
  );

  const menu: ReactNode = useMemo(
    () =>
      open ? (
        <ContextMenu
          key={open.id}
          items={open.items}
          position={open.position}
          label={open.label}
          returnFocusTo={open.row}
          onClose={close}
        />
      ) : null,
    [close, open],
  );

  return { showThreadMenu, showWorkspaceMenu, showWorktreeMenu, showCloneMenu, menu };
}
