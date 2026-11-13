# m35: make "move to another project" and "fork" work in the running app

## Goal

Two thread-menu actions pass their unit tests but fail in the real app. Fix both in the Rust backend, with tests that
would have caught them.

1. **Project → (another project)** fails with "Unknown target project". Every project has its own `WorkspaceSession`,
   and each session owns its own `PiEngine` instances. `PiEngine::relocate` looks the target up in `self.paths`, which
   only ever holds the workspaces registered with that one engine, so the target is never found. The existing tests
   insert the target into `engine.paths` by hand, which hides this.
2. **Fork → Fork in this project** fails silently for oh-my-pi (omp) threads. The generic `thread/fork` path sends the
   engine a `clone` RPC. pi implements `clone`; omp does not (its RPC list has `fork` and `branch` only), so the
   request errors.

Done means both actions work for a pi or omp thread when the source and target projects are served by different
engine instances, and the tests below pass.

## Files

All under `apps/nucode/src-tauri/src/`.

- `shared/codex_core.rs`: `move_thread_core`.
- `codex/mod.rs`: the `move_thread` command (has `state.workspaces`).
- `bin/codex_monitor_daemon.rs`: the daemon's `move_thread` (has `self.workspaces`).
- `shared/pi/threads.rs`: `file_operation`, `relocate`.
- `shared/pi/mod.rs`: the `thread/fork` handling in `dispatch`, `fork_session`.
- `shared/pi/tests.rs` (and a `codex_core` test if one fits): new tests.

No changelog entry is needed; the existing "Thread menu" line under "Unreleased" covers both actions.

Off-limits: everything under `apps/nucode/src/` (frontend), `thread_window.rs`, `menu.rs`, the Tauri capability
files, and any engine package under `apps/nucode/engines/`. Another change is editing the frontend in a different
worktree at the same time.

## Design

### Move

- `move_thread_core` takes the workspace registry as well
  (`workspaces: &Mutex<HashMap<String, WorkspaceEntry>>`). It looks up `target_workspace_id`, returns
  "Unknown target project" when it is missing, and adds the target's folder to the request:
  `{"threadId", "targetWorkspaceId", "targetPath"}`. Update both callers.
- `file_operation` reads `targetPath` and passes it to `relocate`. `relocate` uses it as the new `cwd`. When
  `targetPath` is absent it falls back to `self.paths` as today, so the existing tests keep their meaning.
- After a successful move the source engine must not keep serving the thread unless it also serves the target
  workspace. Today it rewrites its own `sessions` entry to `workspace = target`. If the engine has no path registered
  for `target` (the normal case), remove the entry instead. Otherwise a later move back leaves a stale entry and the
  thread cannot be opened ("Unknown pi thread").
- The engine that serves the target finds the thread through its normal directory scan (`thread/list`,
  `thread/resume`). Confirm this in a test rather than adding a registration call.
- Keep every existing guarantee in `relocate`: the new copy lands whole or not at all, and any failure puts all files
  back.

### Fork for omp

- In `dispatch`, handle `thread/fork` for the omp profile (not chat, not a side chat, not work) without the engine
  process, the same way the chat fork already does:
  - refuse while the source turn is running ("Finish or interrupt the turn before forking"); an idle process does not
    need to be shut down, but nothing may be written through it during the copy;
  - copy with `fork_session(&source, &target, &new_id, &Value::Null, None)`;
  - keep the source thread's `cwd`; set `forkedFromId`; resolve the model with
    `Self::model(&registry, &policy, params.get("model"), Some(&thread))` and write it into the new header, appending
    a `model_change` entry only when it differs from the source's model;
  - copy the conversation team (`config::read_team` / `config::write_team`), as the `clone` path does;
  - insert the new `Session { process: None, .. }`, emit `thread/started` with empty `turns`, and return
    `thread_response(thread, false, "ask")`, exactly the shape the `clone` path returns.
- pi keeps using `clone`.
- If writing fails part-way, remove the new file.

## Constraints

- Follow the file's existing style (dense, few helpers). Do not refactor unrelated code.
- No new dependencies.
- Error strings are shown to users in a toast: keep them short and plain.
- The repository is public. No personal information (names, home paths, hostnames) in code, tests, comments or commit
  messages. Tests use temp directories and made-up ids.
- Commit in small steps with plain-language messages ending with
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.

## Tests to add

1. Move across engines: two `PiEngine` instances sharing one data directory, engine A registered for workspace `a`
   only and engine B for workspace `b` only. A `thread/move` on A with `targetPath` succeeds without `b` in A's
   `paths`; B then lists the thread and can resume it; the session header's `cwd` is the target path. Then move it
   back through B and open it on A.
2. `move_thread_core` passes the target's folder from the registry and rejects an unknown target id.
3. Fork on an omp-profile engine with no `clone` support produces a new session file with a new id, the same entries,
   `forkedFromId` set, the team copied, and a `thread/started` event. The fake engine must fail the test if it
   receives `clone`.
4. Fork is refused while the source turn is running.

## Verification

From `apps/nucode/src-tauri` in this worktree:

```
CARGO_TARGET_DIR="$HOME/nucode/apps/nucode/src-tauri/target" cargo test --lib --locked
```

Everything passes except `shared::pi::tests::managed_preview_bridge_serves_restarts_and_stops_without_user_dialogs`,
which fails on developer machines and passes in CI. The build directory is shared with other worktrees, so a
"Blocking waiting for file lock" pause is normal.

## Out of scope

- Frontend changes of any kind, including error toasts and menu contents.
- Codex and Claude threads: moving and permanent deletion stay unsupported for them.
- Thread windows.
- Building or installing the app.
