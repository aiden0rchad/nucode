# M31: sidebar right-click menus for projects and threads, and scrolling titles

All paths are relative to `apps/nucode/` unless they start with `docs/`.

## Goal

Right-clicking a project or a thread in the Code sidebar opens an in-app menu (not a native OS menu) with icons,
submenus and shortcut hints, modelled on the menus of a well-known desktop coding app. Long project and thread titles
that are cut off scroll sideways on hover to reveal their end. Done when everything under "Design" works and the
verification commands pass.

This is part 1. Part 2 (a later spec) adds the items that need new backend work: moving a thread to another project,
forking into a new worktree, permanent delete, and opening a thread in its own window. Build the menu so those items
can be added without reshaping it.

## Background you need

- Today's menus are native (`@tauri-apps/api/menu`) and built in `src/features/app/hooks/useSidebarMenus.ts`
  (`showThreadMenu`, `showWorkspaceMenu`, `showWorktreeMenu`, `showCloneMenu`), wired through
  `src/features/app/components/Sidebar.tsx` to `ThreadRow.tsx`, `WorkspaceCard.tsx`, `WorktreeCard.tsx`,
  `PinnedThreadList.tsx`.
- Project sections already exist as "workspace groups": `settings.groupId` on a workspace and
  `createWorkspaceGroup` / `assignWorkspaceGroup` in `src/features/workspaces/hooks/useWorkspaceGroupOps.ts`,
  reachable from `src/features/app/hooks/useMainAppModals.ts`. The sidebar renders them in
  `SidebarWorkspaceGroups.tsx` / `WorkspaceGroup.tsx`.
- Thread pins are stored in localStorage (`src/features/threads/utils/threadStorage.ts`,
  `useThreadStorage.ts`). Unread state is the `markUnread` reducer action (`useThreadsReducer.ts`).
- Fork: `forkThreadForWorkspace` in `src/features/threads/hooks/useThreadActions.ts`. Archive: `onDeleteThread`
  (it archives). Rename: `useRenameThreadPrompt.ts`. Transcript text: `buildThreadTranscript` in
  `src/utils/threadText.ts`; Markdown export: `exportMarkdownFile` in `src/services/tauri.ts`.
- Popover and menu building blocks: `src/features/design-system/components/popover/` and
  `src/styles/ds-popover.css`. Look at how the sidebar's "add" menu and the composer queue's "…" menu use them and
  reuse those parts and tokens.

## Design

### The menu component

Create one reusable context menu (suggested: `src/features/design-system/components/menu/ContextMenu.tsx` plus a
stylesheet) used by both menus:

- Opens at the pointer, clamped to stay inside the window with an 8px margin; a submenu opens to the right of its
  parent item, or to the left when there is no room.
- Item kinds: action (icon, label, optional shortcut hint, optional `danger`, optional `disabled` with a reason shown
  as `title`), submenu (icon, label, chevron), separator, and inside submenus a checked state.
- Look: surface, border, radius, shadow and row metrics from the existing popover tokens; 13px labels; 16px lucide
  icons in a fixed 16px column; shortcut hints right-aligned in the muted text color; 6px padding; rows about 28px
  tall; separators as 1px lines with 4px vertical margin. Hover and keyboard focus share one highlight. It must look
  right in both the dark and light themes.
- Behaviour: closes on Escape, on a click or right-click outside, on window blur, on scroll of the sidebar, and
  after an action runs. Up/Down move, Right or Enter opens a submenu, Left closes it, Enter or Space activates, Home
  and End jump. Focus moves into the menu on open and returns to the row on close. Roles: `menu`, `menuitem`,
  `menuitemcheckbox` / `aria-checked` for checked rows, `aria-haspopup` and `aria-expanded` on submenu parents.
  Submenus also open on hover after a short delay (about 120ms) and stay open while the pointer travels into them.
- Only one menu is open at a time. Right-clicking another row moves the menu.
- The row that owns the open menu keeps its hover styling while the menu is open.

### Project menu (right-click a top-level project row)

In this order:

1. **Pin** / **Unpin** — pinned projects sort first inside their section, in the order they were pinned, and show a
   small pin glyph where the row has room. Store pins in localStorage next to the thread pins (new key, same style of
   helper and tests). Manual reordering keeps working among unpinned projects.
2. **Edit** — opens Settings on the Projects section (the existing `openSettings("projects")`).
3. **Section ▸** — lists the existing sections with a check on the project's current one; choosing one assigns it.
   When the project is in a section, a "No section" row removes it. After a separator: **New section…**, which asks
   for a name (reuse the app's existing prompt/modal style used for creating a group or renaming a thread; if there is
   none that fits, a small inline name field inside the submenu is fine), creates the section and assigns the project.
4. **Reveal in Finder** (use the existing `fileManagerName()` for the label on other systems).
5. separator
6. **Archive chats** — archives every thread of that project after a confirmation that states the number of threads.
   Disabled when the project has no threads.
7. separator
8. **Remove project** (danger) — the existing remove flow, with its existing confirmation.

"Reload threads" leaves this menu (the sidebar header already has a refresh button). Do not add a "…" button to
rows. The worktree and clone rows keep their current items but must use the new menu component too, so every
sidebar menu looks the same.

### Thread menu (right-click a thread row, in the project lists and in the pinned list)

In this order:

1. **Rename**
2. **Pin** / **Unpin** (only where pinning is allowed today)
3. **Mark as unread** / **Mark as read**. Marking unread shows the row's existing unread indicator until
   the thread is opened again. Marking the open thread unread keeps it unread until the user leaves and returns.
4. separator
5. **Section ▸** — puts the *chat* in a sidebar section: same submenu as for projects (sections list with a check,
   "No section", "New section…"). A chat that is in a section is listed directly under that section's header, above
   the section's projects, and is no longer listed under its project. Its row shows the project name as secondary
   text where the pinned list does so today. Store this in localStorage like pins. A stored section that no longer
   exists means "no section". Sub-agent threads and threads of worktrees or clones do not get this item.
6. **Fork ▸** — one row for now: "Fork in this project" (the existing fork). Part 2 adds a second row.
7. **Checkpoints…** — the existing item.
8. separator
9. **Share…** — saves the conversation as a Markdown file through the existing export dialog. nucode has no
   accounts or hosted links, so this is what sharing means here.
10. **Copy ▸** — "Copy as Markdown", "Copy working directory", "Copy session ID".
11. separator
12. **Archive**
13. (part 2 adds "Open in new window" above Archive and "Permanently delete" below it)

Details:

- Share and Copy as Markdown must work for a thread that is not currently open: load its items first through the
  same path the app uses when opening a thread, without switching the visible thread.
- "Sync from server" leaves the menu. Keep the handler; it is still used elsewhere if it is.
- The menu component supports shortcut hints, but pass none in this part: the shortcuts themselves need backend
  settings fields and arrive in part 2. Never show a hint for a shortcut that does not work.

### Scrolling titles

- Applies to project names, thread names and section-list thread names in the sidebar (including pinned rows).
- Only when the text is actually cut off. On pointer hover of the row (and on keyboard focus), after a 400ms delay,
  the text slides left at a steady 40px per second until its end is visible, then stops there. When the pointer
  leaves, it returns to the start (a quick 150ms slide is fine). While sliding, the trailing ellipsis is not drawn;
  use a soft fade mask on the clipped edge instead of an ellipsis if that is simple, otherwise keep the ellipsis at
  rest only.
- Respect `prefers-reduced-motion`: no sliding; the full title stays available through the row's `title`.
- Measure overflow cheaply (on hover, not for every row on every render). Search-match highlighting inside names
  must keep working.
- The row's time/count/badge columns on the right must not move or be covered.

## Files

- Create: the context menu component, its stylesheet and tests; a small hook or component for scrolling titles and
  its test; storage helpers for project pins and thread sections with tests.
- Modify: `src/features/app/hooks/useSidebarMenus.ts` (and its test), `Sidebar.tsx`, `SidebarWorkspaceGroups.tsx`,
  `WorkspaceGroup.tsx`, `WorkspaceCard.tsx`, `WorktreeCard.tsx`, `ThreadRow.tsx`, `ThreadList.tsx`,
  `PinnedThreadList.tsx`, `src/styles/sidebar.css`, and the thread hooks needed for unread/fork/copy/share.
- Off-limits: `src/features/composer/`, `src/styles/composer.css`, `src/features/messages/`,
  `src/features/chat/ChatView.tsx`, `src/features/work/WorkView.tsx`, `src/services/dragDrop.ts`,
  `src/features/session/` (other work is in progress there), everything under `src/features/settings/` and
  `src/styles/settings.css` (a redesign of Settings is in progress in parallel), and all Rust in this part.

## Constraints

- Follow the surrounding code style and test style (vitest + Testing Library). No new dependencies.
- Icons from `lucide-react`, imported the way neighbouring files import them.
- Keep text sizes at 12px or above in the sidebar and menus.
- The Chat and Work mode sidebars are separate components: do not change their behaviour, but if they call
  `useSidebarMenus`, keep them working.
- The repository is public: no personal names, home-directory paths, hostnames or project names from this machine in
  code, tests, comments or commit messages.
- Commit on the current branch in small commits with imperative subject lines. Do not push.

## Verification

Run from `apps/nucode/` until all pass:

```
npm run typecheck
npx eslint src --ext .ts,.tsx
npx vitest run --testTimeout=30000
```

New tests must cover at least: menu keyboard navigation, submenu open/close, close on outside click and Escape, and
focus return; every project-menu and thread-menu item calls the right handler with the right ids; pin ordering for
projects; a chat assigned to a section renders under that section and not under its project, and falls back when the
section is gone; mark unread/read; a shortcut hint renders when one is passed; titles only animate when cut off and
not under reduced motion.

Also start the UI preview (`npm run preview:ui`, port 1421; if the port is busy use `npx vite --mode uipreview --port
1431 --strictPort`) and check both menus by eye in a browser you can drive (Playwright is available under
`engines/browser/node_modules`; use WebKit, since the app runs in WKWebView): open each menu and submenu, in the dark
and the light theme, at the sidebar's narrowest and a normal width, and fix what looks off (clipping at window edges,
misaligned icons, hint column, focus ring). Save the screenshots you judged by under `.tmp/m31-shots/` in the
repository root and list them in your report.

## Out of scope

Part 2 items (including keyboard shortcuts), the Chat and Work sidebars' own menus, Settings, the composer,
the transcript, and Rust.

## Report

What you changed, decisions you had to make that this spec did not settle, anything you could not do or verify, the
screenshot list, and the final output of the three verification commands.
