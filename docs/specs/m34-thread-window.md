# M34: open a thread in its own window

All paths are relative to `apps/nucode/` unless they start with `docs/`.

## Goal

The thread menu gains "Open in new window". It opens that one conversation in a second OS window that shows only
the transcript and the composer, while the main window keeps working. Opening the same thread again focuses its
window. Closing a thread window never quits or hides the app. Done when everything under "Design" works and the
verification commands pass.

## Background you need

- There is one real window, `main` (`src-tauri/tauri.conf.json`). The only other one is `about`, built in
  `src-tauri/src/menu.rs` with `WebviewWindowBuilder` and `index.html`; `src/App.tsx` branches on the window label
  (`useWindowLabel`) to render the About view. `useWindowLabel` starts as `"main"` and reads the real label in an
  effect, so a new window would mount the whole app for one render.
- Backend events reach the frontend through `event_sink::emit` (`src-tauri/src/event_sink.rs`), which only delivers
  to the labels `is_app_webview` allows (`main`, `about`); `multiwebview_tests.rs` pins that list. Menu events,
  the tray's "open thread" and `computer-approval` are sent to `main` only.
- `src-tauri/capabilities/default.json`: `desktop-default` covers the webviews `main` and `about`.
- `lib.rs`: `on_window_event` handles only `main` (on macOS closing it hides it); the window-state plugin skips
  `browser-` labels; password and Computer Use approval commands accept calls from `main` only (keep that).
- `menu.rs`: Close Window, Minimize, Zoom and Full Screen act on `main` whatever window is focused, and
  `emit_menu_event` shows and focuses `main` before sending.
- The transcript and composer depend on most of the hooks in `src/features/app/components/MainApp.tsx`, so the
  thread window runs the same `MainApp` in a restricted mode rather than a second root. `DesktopLayout` takes the
  sidebar, messages and composer as separate nodes. A freshly mounted app opens a thread through
  `openThreadLinkOrQueue(workspaceId, threadId)` in `MainApp.tsx`, which waits for workspaces, connects and resumes.
- Thread menu: `src/features/app/hooks/useSidebarMenus.tsx` (its test sits next to it).

## Design

### Rust

1. New module `src-tauri/src/thread_window.rs` with three commands, registered in `lib.rs`:
   - `open_thread_window(workspace_id, thread_id, title)`: the label is `thread-<id>` where `<id>` is the thread id
     if it only contains `A-Za-z0-9_-`, otherwise its lowercase hex encoding (one pure function, unit-tested; a
     label must be derivable from the thread id alone). If a window with that label exists: unminimize, show,
     focus, return. Otherwise build it like the About window but with main's look (overlay title bar, hidden title,
     the same traffic-light position, transparent, drag-and-drop enabled), inner size 760×820, minimum 420×480,
     the given title (fallback "nucode"). Hand the window its target synchronously with
     `initialization_script`: one assignment of a `serde_json`-encoded object
     `{ workspaceId, threadId }` to `window.__NUCODE_THREAD_WINDOW__` (never build that script by string
     concatenation of raw ids).
   - `close_thread_window(thread_id)`: closes that thread's window if it exists.
   - `retarget_thread_window(thread_id, workspace_id)`: `emit_to` that window an event
     `thread-window-retarget` with the new workspace id.
   Desktop only; on mobile targets the commands return an error.
2. `event_sink::is_app_webview` also accepts labels starting with `thread-`; update the pinned test.
3. `capabilities/default.json`: add `thread-*` to `desktop-default`, and `core:window:allow-set-title`. Confirm the
   glob is honoured for webview labels (Tauri docs or source); if it is not, say so in the report and use the
   mechanism that is.
4. `lib.rs`: the window-state plugin also skips `thread-` labels; when `main` is destroyed (the non-macOS path)
   every `thread-*` window is closed too; closing a thread window just destroys it.
5. `menu.rs`: Close Window, Minimize, Zoom and Full Screen act on the focused window (fall back to `main` when no
   app window is focused). The four `composer_*` menu events go to the focused window when it is a thread window,
   without showing or focusing `main`; every other menu event keeps going to `main` as today.
6. Settings stay in step between windows: after the command that saves app settings succeeds, emit
   `app-settings-updated` to the app webviews with `{ origin: <calling window's label>, settings }`.
7. A menu-bar entry point: File → "Open Thread in New Window" sends a menu event to `main`, which opens the active
   thread's window (no-op without an active thread).

### Frontend

1. `src/features/app/threadWindow.ts`: reads `window.__NUCODE_THREAD_WINDOW__` once, synchronously, and exports the
   target (or null) plus a `ThreadWindowContext`/hook `useThreadWindow()`. `App.tsx` decides from it before the
   first render (no effect-driven label flip) and does not render `<ComputerApprovals/>` in a thread window.
2. In a thread window `MainApp`:
   - opens the target through `openThreadLinkOrQueue` on mount and again on `thread-window-retarget`;
   - renders no sidebar, home, session rail, side panel (browser, files), terminal dock or mode switch, and forces
     the code-mode thread view without persisting that; the top bar shows the thread title and the window can be
     dragged by it; the composer keeps model, effort and access pickers, attachments, file drop, stop and the
     approval and question cards;
   - sets the window title to the thread's name and keeps it current when the name changes;
   - closes itself when its thread is archived or deleted (the thread leaves state after having been loaded).
3. Effects that must not run in a thread window (each needs a guard at its call site, driven by
   `useThreadWindow()`; keep the list in one place and test it):
   automatic thread titles (`threadTitleAutogenerationEnabled`), the tray's recent-threads sync, sounds and system
   notifications (including the response-required notifications), the updater check, dictation, the menu-event
   and global shortcut listeners other than the four composer cycles and Stop, the thread shortcuts (rename, pin,
   mark as unread, archive), the mobile server setup and notification thread links, session and workspace restore
   beyond the target workspace, automatic approval responses (the card is shown; only a click answers it), and
   every write to shared `localStorage` state (sidebar width and collapsed state, mode, thread activity, pins,
   sections, layout). Main owns that state; the thread window only reads it.
4. `useAppSettings` listens for `app-settings-updated` and replaces its copy when the origin is another window,
   without saving again. Check that no save loop is possible.
5. Thread menu (`useSidebarMenus.tsx`): "Open in new window" after "Copy ▸" and before the separator above
   Archive. It calls `openThreadWindow`. Disabled with a reason in `title` while the app is in Remote backend mode
   ("Not available in Remote mode") — opening a second live subscription there is not verified, so it stays off.
   Main also calls `closeThreadWindow` after a successful archive or permanent delete, and
   `retargetThreadWindow` after a successful move to another project.
6. `src/services/tauri.ts`: `openThreadWindow`, `closeThreadWindow`, `retargetThreadWindow`, plus entries in the UI
   preview's mocked IPC (`src/dev/uiPreview/`) so the preview keeps working.

## Files

- Create: `src-tauri/src/thread_window.rs`, `src/features/app/threadWindow.ts` (+ tests).
- Modify (Rust): `lib.rs`, `event_sink.rs`, `multiwebview_tests.rs`, `menu.rs`, `capabilities/default.json`, the
  settings save command.
- Modify (TypeScript): `src/App.tsx`, `src/features/layout/hooks/useWindowLabel.ts` if needed,
  `src/features/app/components/MainApp.tsx` and the hooks whose effects need guards, `useSidebarMenus.tsx` and its
  test, `useAppSettings.ts`, `src/services/tauri.ts`, `src/dev/uiPreview/`.
- Off-limits: `src/features/settings/components/` and `src/styles/settings.css` (being redesigned on another
  branch), `src/features/composer/`, `src/features/messages/`, the browser and Computer Use Rust modules.

## Constraints

- Follow the surrounding code and test style. No new dependencies (Rust or npm).
- The main window's behaviour must not change when no thread window is open. Every guard is "not in a thread
  window", never a change to what main does.
- The repository is public: no personal names, home-directory paths, hostnames or project names from this machine
  in code, tests, comments or commit messages.
- Commit on the current branch in small commits with imperative subject lines. Do not push.

## Verification

From `apps/nucode/`:

```
npm run typecheck
npx vitest run --testTimeout=30000
```

From `apps/nucode/src-tauri/` (run cargo commands one at a time):

```
cargo test --lib --locked
```

New tests must cover at least: the label function (plain id, id with other characters, stability); the event
filter accepts `thread-…` and still rejects `browser-…`; the capability file lists the thread windows; the menu
item calls the service with the right ids, sits in the right place and is disabled in Remote mode; archive, delete
and move call close or retarget; a thread window's target is read synchronously and `MainApp` in that mode renders
no sidebar and does not start the guarded effects (test the guard list); a settings update from another window
replaces the local copy without saving, and one from the same window is ignored.

## Out of scope

Thread windows in Remote backend mode, restoring thread windows after a restart, dictation in a thread window,
the browser or terminal inside a thread window, and everything in the off-limits list.

## Report

What you changed, what you found for each "confirm" above, decisions this spec did not settle, anything you could
not do or verify (the real windows cannot be exercised by the tests; list what should be checked by hand), and the
final output of the three verification commands. Copy commit hashes from `git log`.
