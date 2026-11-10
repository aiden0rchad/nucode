# M11 — Sidebar: drag to reorder projects and threads, hover pin

## Goal

In the Code sidebar (organize mode "By project"), the user can:

1. **Drag a project** (its header row) up or down to rearrange projects. The order persists.
2. **Drag a thread** up or down **inside its own project** to rearrange it. A thread can never be
   dropped into another project or anywhere outside its project's list. The order persists.
3. **Pin a thread from the row**: hovering a thread row shows a pin button on the right side of the
   row (like Codex Desktop's "Pin chat"). Clicking it pins the thread to the top of its project;
   on a pinned row the button is always visible (filled pin) and clicking it unpins.

Done = all three work in the real UI, are keyboard accessible, and the verification command passes.

## Existing code to build on (read these first; use codegraph_explore)

- `src/features/app/components/Sidebar.tsx` — organize modes (`threadListOrganizeMode`:
  `by_project` | `by_project_activity` | `threads_only`), search (`isSearchActive`), renders
  `SidebarWorkspaceGroups`. Receives `pinThread`/`unpinThread`/`isThreadPinned`/`getPinTimestamp`.
- `src/features/app/components/SidebarWorkspaceGroups.tsx`, `WorkspaceGroup.tsx`,
  `WorkspaceCard.tsx` — project sections and project header rows (incl. worktree/clone children).
- `src/features/app/components/ThreadList.tsx`, `PinnedThreadList.tsx`, `ThreadRow.tsx` — thread
  rows. `ThreadRow` already has `canPin = depth === 0`, `isPinned`, a `.thread-meta` area with
  `.thread-time` and the `…` `.thread-menu-trigger`.
- `src/features/app/hooks/useThreadRows.ts` — builds `pinnedRows` / `unpinnedRows` per project
  (roots + nested subagent/side-chat children), "Show more" slicing (3 visible when collapsed),
  per-call cache keyed by `cacheKey` + `pinVersion`.
- `src/features/workspaces/domain/workspaceGroups.ts` — projects are sorted by
  `settings.sortOrder` then name within each workspace group (the "By project" order).
- `src/features/app/orchestration/useWorkspaceOrchestration.ts` —
  `useWorkspaceOrderingOrchestration().handleMoveWorkspace(id, "up"|"down")` rewrites
  `sortOrder` for all projects in the same group via `updateWorkspaceSettings`. Find where it is
  created/passed (MainApp / layout nodes) and wire a new reorder handler the same way.
- `src/features/app/hooks/useSidebarMenus.ts` — the right-click menu's Pin/Unpin (reuse the same
  `pinThread`/`unpinThread` semantics, including what happens when `pinThread` returns false).
- Existing native HTML5 drag-and-drop patterns that already work in this Tauri webview:
  `src/features/session/CodeSessionRail.tsx` (grip, `dataTransfer`, Up/Down keyboard reorder) and
  `src/features/panels/SidePanel.tsx`. Use native HTML5 DnD; **do not add a dependency**.

## Behavior

### Projects
- Draggable: top-level main project header rows only, only when organize mode is `by_project`
  and search is not active. Worktree/clone child rows are not draggable; they move with their
  parent.
- A project can only be dropped among projects of the **same workspace group section**
  (including the ungrouped section). Elsewhere: no drop (do not call `preventDefault` on
  dragover), cursor shows not-allowed, nothing changes.
- Drop position: before or after the hovered project, by pointer Y against the row's midpoint.
  Show a 2px accent insertion line on that edge.
- Persist: add `handleReorderWorkspace(workspaceId, targetWorkspaceId, position: "before"|"after")`
  next to `handleMoveWorkspace`; it computes the new order of that group and writes
  `sortOrder = index` for every project in the group (same as `handleMoveWorkspace`). Only write
  projects whose `sortOrder` actually changes.
- Keyboard: with a project header focused, `Alt+ArrowUp` / `Alt+ArrowDown` moves it one place
  (call the existing `handleMoveWorkspace`).

### Threads
- Draggable: root thread rows (`depth === 0`) in a project's list, only in `by_project` /
  `by_project_activity` modes and when search is not active. Nested child rows are not draggable
  and move with their root. No dragging in `threads_only` ("Recent conversations").
- A thread can only be dropped on root rows of the **same project and same section** (pinned
  among pinned, unpinned among unpinned). Anything else (another project, a project header, the
  pinned section from unpinned, empty space): no drop, not-allowed cursor, snaps back.
- Drop position and insertion line: same rule as projects.
- Persist a manual order per project in a new hook `src/features/app/hooks/useThreadOrder.ts`,
  stored in localStorage under `nucode.threadOrder.v1` as `{ [workspaceId]: threadId[] }`
  (wrap every storage access in try/catch; keep an in-memory copy and a `version` number that
  changes on every write so memoized rows re-render). Follow how `useThreadStorage.ts` stores
  pins/custom names.
- Ordering in `useThreadRows`: within pinned roots and within unpinned roots separately, roots that
  appear in the project's manual order are sorted by their index in it; roots that are not in it
  (new threads, or a project never reordered) come **first**, keeping their current order. With
  no manual order the result is exactly today's order (pins by pin time, unpinned by recency).
  Include the order `version` in the cache key.
- On drop: take the section's full current root order (all unpinned roots, not only the 3
  visible), move the dragged id before/after the target, and save the project's order as
  `[...pinnedOrder, ...unpinnedOrder]` (ids only; unloaded ids already in the stored list keep
  their relative place at the end).
- Keyboard: with a thread row focused, `Alt+ArrowUp` / `Alt+ArrowDown` moves it one place within
  its section.
- A plain click on a row still selects it; starting a drag must not select it or open the menu.

### Hover pin button
- In `ThreadRow`, for rows with `canPin`, add a pin `IconButton` (lucide `Pin` / `PinOff`, 14px)
  in `.thread-meta` to the left of the `…` button, `aria-label` "Pin thread" / "Unpin thread",
  `title` the same. `stopPropagation` so it never selects the row.
- Unpinned rows: hidden until the row is hovered or has focus-within; while shown, the relative
  time is hidden so the row doesn't grow (same space the `…` trigger uses — match how it is
  revealed today in CSS). Pinned rows: always visible, filled/accent pin; clicking unpins.
- Pass `onTogglePin` (or `onPinThread`/`onUnpinThread`) down from `Sidebar` through
  `SidebarWorkspaceGroups`/`ThreadList`/`PinnedThreadList`/`SidebarThreadsOnlySection` to
  `ThreadRow`, using the same `pinThread`/`unpinThread` the context menu uses.

### Styling
- Put drag/drop/pin styles next to the existing sidebar thread/project row styles (find the CSS
  file that styles `.thread-row`, `.thread-menu-trigger`, and the workspace header). Dragged row:
  `opacity: .5`. Insertion line: `box-shadow: inset 0 2px 0 var(--accent…)` (top) or the bottom
  equivalent, using an existing accent token. Draggable rows get `cursor: grab` only while
  hovering the row; no layout shift. Respect `prefers-reduced-motion` (no animations needed).

## Files

Expected (adjust if codegraph shows a better place, but keep the change focused):
- new `src/features/app/hooks/useThreadOrder.ts` (+ `useThreadOrder.test.ts`)
- `src/features/app/hooks/useThreadRows.ts` (+ extend `useThreadRows.test.tsx`)
- `src/features/app/components/Sidebar.tsx`, `SidebarWorkspaceGroups.tsx`, `WorkspaceGroup.tsx`,
  `WorkspaceCard.tsx`, `ThreadList.tsx`, `PinnedThreadList.tsx`, `ThreadRow.tsx`,
  `SidebarThreadsOnlySection.tsx` (pin button only)
- `src/features/app/orchestration/useWorkspaceOrchestration.ts` and the place that wires its
  handlers into `Sidebar` (MainApp / layout nodes)
- the sidebar CSS file(s)
- tests: `ThreadList.test.tsx`, `PinnedThreadList.test.tsx`, `Sidebar.test.tsx` and/or a
  workspace-ordering test

Off-limits: anything under `src-tauri/`, `src/features/onboarding/`,
`src/features/settings/components/sections/SettingsImportSection.tsx`, `docs/specs/` other than
this file. Do not change the Settings → Projects up/down buttons.

## Constraints
- React + TypeScript, existing design-system primitives (`IconButton` etc.), lucide icons.
- No new dependencies. Native HTML5 drag-and-drop with drag state held in React (dataTransfer is
  unreadable during dragover); set `dataTransfer.effectAllowed = "move"` and some `text/plain`
  data so WebKit starts the drag.
- Keep the existing look: no new borders/backgrounds on rows except the drag states and the pin
  button.
- Follow surrounding code style (terse, no comments that restate code).

## Tests (vitest + Testing Library)
1. `useThreadRows`: manual order sorts unpinned and pinned roots; unknown/new ids come first;
   children stay under their root; no order = today's order; collapsed view shows the first 3 of
   the manual order.
2. `useThreadOrder`: saves/loads per workspace, survives a storage exception, bumps version.
3. Thread drag: dragstart on a root row + dragover/drop on another root row of the same project
   and section saves the new order (row order in the DOM changes); dropping on a row of another
   project or on the pinned section from an unpinned row does nothing (and dragover is not
   prevented).
4. Project drag: drop before/after another project in the same group calls the reorder handler
   with the right args; a project from another group is rejected; disabled in
   `by_project_activity` and during search.
5. `handleReorderWorkspace` writes the expected `sortOrder` values.
6. Pin button: hidden-until-hover class/attribute on unpinned rows, visible on pinned rows;
   clicking calls pin/unpin and does not select the thread.
7. `Alt+ArrowUp/Down` reorders a focused thread and a focused project.

## Verification
Run from `apps/nucode`:

```
npx tsc --noEmit && npx vitest run src/features/app src/features/threads src/features/workspaces src/features/settings
```

It must pass with no new failures.

## Out of scope
- Dragging threads between projects, dragging into/out of groups, reordering groups.
- Changing the "Recent conversations" (threads_only) list, the Chat mode list, or Work mode.
- Backend/Rust changes; persisting thread order outside localStorage.
