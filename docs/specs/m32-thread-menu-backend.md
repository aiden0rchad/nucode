# M32: thread menu, part 2: archive that persists, permanent delete, move to another project, fork into a worktree, shortcuts

All paths are relative to `apps/nucode/` unless they start with `docs/`. This continues M31
(`docs/specs/m31-sidebar-context-menus.md`); the menu component and both menus exist.

## Goal

The thread menu gains the items that need backend work, and the existing Archive item starts to persist for the
pi-RPC engines. Done when everything under "Design" works and the verification commands pass.

"Open in new window" is not part of this spec; it follows separately.

## Background you need

- A thread request travels: Tauri command in `src-tauri/src/codex/mod.rs` (with a remote-mode passthrough) →
  `src-tauri/src/shared/codex_core.rs` (`archive_thread_core`, `fork_thread_core`) → the engine router in
  `src-tauri/src/shared/engines.rs` → one backend: Codex app-server, `shared/pi/mod.rs` (`PiEngine::request`, used by
  the pi and omp engines), or `shared/acp/mod.rs`. The daemon binary mirrors the commands in
  `src-tauri/src/bin/codex_monitor_daemon.rs` and `bin/codex_monitor_daemon/rpc/codex.rs`. Follow how
  `archive_thread` is wired through each of these layers for every new command.
- pi-RPC sessions are files: `<data>/<engine>/sessions/<workspaceId>/<threadId>.jsonl` (`PiEngine::directory`), with
  optional siblings `<threadId>.jsonl.streams/` and `<threadId>/`. The first line is a JSON header that holds `id`
  and `cwd`. `PiEngine::scan` lists only `*.jsonl` files directly in that folder. Per-thread extras live elsewhere:
  thread metadata (`shared/sidechats.rs::metadata_path`, `storage.rs`), team config (`pi/config.rs::read_team` /
  `write_team`), checkpoints (`shared/checkpoints/`).
- **Archive does not work for pi-RPC threads today.** `PiEngine::request` has no `thread/archive` arm and ends in
  `Err("Pi does not support {method}")`; the frontend drops the thread from its state and swallows the error
  (`useThreads.ts::removeThread`, `useThreadActions.ts::archiveThread`), so the thread comes back at the next list.
  Confirm this with a failing test before fixing it. `shared/acp/mod.rs` already archives through metadata; Codex
  archives in its app-server.
- Frontend: `src/services/tauri.ts` (service functions), `src/features/threads/hooks/useThreads.ts` and
  `useThreadActions.ts`, `src/features/app/hooks/useSidebarMenus.ts` (menus from M31), worktree creation prompt
  (`useWorktreePrompt` and the flow behind "New worktree agent"), shortcuts: `AppSettings` in `src/types.ts` and
  `src-tauri/src/types.rs` (see `archive_thread_shortcut` for the full pattern, including defaults on both sides),
  `ShortcutSettingKey` / `ShortcutDraftKey` in `src/features/settings/components/settingsTypes.ts`, defaults in
  `src/features/settings/hooks/useAppSettings.ts`, and the hook that already handles `archiveThreadShortcut`.

## Correction to part 1 (do this first)

`loadThreadItems` in `src/features/threads/hooks/useThreads.ts` resumes the thread and then waits 50 ms for state to
catch up. Resuming starts that thread's engine process just to read it, and the timer is a guess. Replace it with a
read that has no side effects: fetch the thread with the read-only service (`readThread` in `src/services/tauri.ts`),
convert it with the same builders the resume path uses, and when the thread has older history pages, fetch them
through `listThreadHistory` until there are none left (cap the loop and say in a toast if the cap was hit), so
"Share…" and "Copy as Markdown" export the whole conversation and not just the most recent page. It must not
dispatch to the thread state, must not start a process, and must not use a timer. An already loaded thread may use
its loaded items only if its history is complete; otherwise page the rest the same way. Update the tests.

## Design

### Backend: three file-level operations for pi-RPC threads

All three run in `PiEngine::request` before anything spawns a process, take `threadId`, and refuse with a clear
error while that thread has a turn running ("Finish or interrupt the turn first"). If an idle process is attached
to the thread, shut it down first. Validate ids the way `directory` and `has_session` do; never build a path from
unvalidated input, and never touch a file outside the engine's sessions folder.

1. `thread/archive`: move the session file and its two optional siblings into `sessions/<workspaceId>/archived/`
   (create it; `scan` must keep ignoring it), drop the thread from the in-memory map, and emit the same
   notification the other engines emit when a thread is archived (find what the frontend's `onThreadArchived`
   listens for). Sub-agent and side-chat threads of the archived thread follow whatever rule the frontend's cascade
   already applies; do not add a second cascade.
2. `thread/delete`: permanently remove the session file and its siblings (from the live folder or from
   `archived/`), plus that thread's metadata file, team config and checkpoint record. Emit the archived
   notification so every window drops it. Missing extras are not an error; a missing session file is.
3. `thread/move` with `targetWorkspaceId`: the target must be a known workspace handled by the same engine. Rewrite
   the header line's `cwd` to the target workspace's path (only the header line; write to a temporary file in the
   target folder and rename it into place, so a crash cannot leave half a file), move the siblings, move the thread
   metadata, leave checkpoints behind (they belong to the old project's files), update the in-memory map, emit
   "archived" for the old workspace and `thread/started` for the new one, and return the thread in the same shape
   `thread/fork` returns it. If any step fails, the original file must still be in place.

For the other backends: ACP gets `thread/delete` (remove the thread from its store) and `thread/move` returns
"Moving is only available for pi and omp threads"; Codex returns "Not available for Codex threads" for both new
methods. Do not attempt to delete Codex rollout files.

Add Tauri commands `delete_thread` and `move_thread` (`archive_thread` exists), their remote passthroughs, the
daemon mirrors, registration in the invoke handler, and service functions `deleteThread` and `moveThread` in
`src/services/tauri.ts` (+ entries in the UI preview's mocked IPC so the preview keeps working).

### Thread menu additions (order within the M31 menu)

- **Project ▸** after "Mark as unread": lists the other top-level projects (not worktrees or clones; current
  project checked and disabled). Choosing one moves the thread there, selects it in its new project, and shows a
  toast "Moved to <project>". Disabled with a reason in `title` for running threads, sub-agent threads, and engines
  that cannot move. If the thread is assigned to a sidebar section or pinned, it keeps both under its new
  workspace id (update the stored keys).
- **Fork ▸** gains "Fork into a new worktree": opens the existing new-worktree prompt for the thread's project;
  after the worktree workspace is created, fork the thread and move the fork into the worktree workspace, then
  select it. If the fork succeeds and the move fails, keep the fork where it is and say so in the error toast.
  Disabled for projects that are not git repositories (use the check the existing worktree action uses).
- **Permanently delete** (danger) at the very bottom, under Archive, after a separator: a confirmation that names
  the thread and says it cannot be undone (use the app's existing confirm dialog helper); then `deleteThread`,
  remove it from state, pins and section assignments. Disabled with a reason for running threads and for Codex
  threads.
- **Archive** now also removes the thread's pin and section assignment (if it does not already), and when the
  backend call fails the thread is restored in the list and an error toast is shown instead of failing silently.
  "Archive chats" in the project menu reports how many were archived and how many failed.

### Shortcuts and hints

- New settings, wired exactly like `archiveThreadShortcut` (TypeScript type, defaults, Rust field with serde
  default, draft keys, the Shortcuts section's list of definitions):
  - `renameThreadShortcut`, default `cmd+alt+r` (`ctrl+alt+r` off macOS);
  - `pinThreadShortcut`, default `cmd+alt+p` (`ctrl+alt+p`);
  - `markThreadUnreadShortcut`, default `cmd+shift+u` (`ctrl+shift+u`).
  They act on the active thread, do nothing when there is none, and are ignored while a modal is open. Check each
  default against the existing defaults and the app menu accelerators for clashes before settling; if one clashes,
  pick the nearest free combination and say so in the report.
- The thread menu shows hints for Rename, Pin/Unpin, Mark as unread and Archive (the existing
  `archiveThreadShortcut`), formatted with the helper the app already uses to display shortcuts. A shortcut the user
  cleared shows no hint.
- The Settings Shortcuts section is being redesigned on another branch. Add your three rows to its data (the list
  of shortcut definitions, labels and draft handling) with the smallest possible change and do not restyle or
  restructure that file.

## Files

- Modify (Rust): `src-tauri/src/shared/pi/mod.rs` (+ `pi/tests.rs`), `shared/acp/mod.rs`, `shared/engines.rs`,
  `shared/codex_core.rs`, `codex/mod.rs`, `lib.rs` (handler registration), the daemon files named above, `types.rs`.
- Modify (TypeScript): `src/services/tauri.ts`, the thread hooks, `useSidebarMenus.ts` and its test, the sidebar
  storage helpers from M31, `src/types.ts`, the settings types/defaults/shortcut list, `src/dev/uiPreview/`.
- Off-limits: `src/features/composer/`, `src/styles/composer.css`, `src/features/messages/`,
  `src/features/chat/ChatView.tsx`, `src/features/work/WorkView.tsx`, `src/services/dragDrop.ts`,
  `src/features/session/`, `src/styles/settings.css`, the settings primitives, and the layout of any Settings
  section (data-only additions as described above are allowed).

## Constraints

- Follow the surrounding code and test style. No new dependencies (Rust or npm).
- Never delete or move anything outside the engine's own sessions folder and the per-thread extras named above. The
  tests must use temporary directories only.
- The repository is public: no personal names, home-directory paths, hostnames or project names from this machine in
  code, tests, comments or commit messages.
- Commit on the current branch in small commits with imperative subject lines. Do not push.

## Verification

From `apps/nucode/`:

```
npm run typecheck
npx eslint src --ext .ts,.tsx
npx vitest run --testTimeout=30000
```

From `apps/nucode/src-tauri/` (the engines need their dependencies once: `npm ci --prefix ../engines/pi` and
`npm ci --prefix ../engines/browser`; reuse the main checkout's build cache by exporting the `CARGO_TARGET_DIR` you
are given, and run cargo commands one at a time):

```
cargo test --lib --locked
```

New tests must cover at least: archive moves the file and its siblings and `thread/list` no longer returns the
thread (write this test first and see it fail on the current code); delete removes the file, siblings and extras;
move rewrites only the header's `cwd`, lands the file in the target folder, keeps the rest of the file byte for
byte, and leaves the original in place when the target is invalid; all three refuse while a turn is running; path
validation rejects ids with separators or dots; each menu item calls the right service with the right ids and is
disabled in the cases listed; pins and section assignments follow a moved thread and are dropped for a deleted
one; a failed archive restores the row; the three shortcuts fire their actions and their hints render.

## Out of scope

Opening a thread in its own window, an "Archived" list or unarchive UI, moving Codex or ACP threads, and
everything in the off-limits list.

## Report

What you changed, decisions this spec did not settle, anything you could not do or verify, and the final output of
all four verification commands.
