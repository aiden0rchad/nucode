# M13 — Browser agent fixes from a real-site run

Observed in the real app (2026-11-09): the user had a tab open in the browser panel of a new
"New Agent" draft thread and asked the omp agent to use the in-app browser. The tab vanished,
a blank tab appeared and the agent navigated that one; the tool rows read
"Read mcp__nucode_browser_browser_navigate" and counted as files; the app quit (no crash report) while
the agent's first `browser_snapshot` was running. Later runs worked but each browser tool cost an extra
model turn to read its schema first.

## Goal
1. A draft thread's panel tabs (including browser tabs) stay with the thread it becomes.
2. omp's tool-schema lookups (`read xd://mcp__…`) no longer show as file reads.
3. A Rust panic is reliably recorded in diagnostics (location + thread) before the process dies.
4. omp sees the nucode browser tools' schemas up front, so it does not spend a turn per tool reading them.

Done = all four implemented with tests, and the verification commands pass.

## 1. Keep the draft's panel tabs when the draft becomes a thread
Code: `apps/nucode/src/features/app/hooks/useSidePanelState.ts` (and `src/features/panels/panelState.ts`
if a helper belongs there). Scopes are `code:<workspaceId>:<threadId>`; a draft has an empty thread id
(`code:<ws>:`), and state is saved per scope in localStorage `nucode.panel.<scope>`.

Today: `if (saved.scope !== scope) setSaved({ scope, state: load(scope) })` loads the new thread's
(empty) state, the panel opens a fresh blank browser page, and the draft's tabs stay orphaned under
`nucode.panel.code:<ws>:`.

Change: when the scope changes from a draft scope `code:<ws>:` to `code:<ws>:<id>` (same workspace,
non-empty id) **and** there is no saved state for the new scope, carry the previous (draft) state over
as the new scope's state (tabs, active, browserActive, open, dock — everything), persist it under the
new key, and reset the draft key to an empty/default state so the next draft starts clean. Browser tabs
keep their `target` (the native page id), so the same native page stays bound and no new page is opened.
In every other case behavior is unchanged (a thread with saved state keeps its own; chat/work scopes are
untouched). Keep it in one place; no new dependencies.

Tests (vitest, alongside the existing panel/side-panel tests — find them with codegraph):
- draft → new thread with no saved state: the browser tab (with its target) is present in the new
  scope, no `new` browser request is made for it, the draft key is reset;
- draft → existing thread that has saved state: the thread's own state is used;
- non-draft → thread: unchanged.

## 2. omp tool-schema lookups are not file reads
omp (oh-my-pi) exposes MCP tools as `xd://` devices: `read xd://mcp__<server>_<tool>` returns the
tool's docs/schema, `write xd://…` calls it. The pi adapter (`src-tauri/src/shared/pi/translate.rs`
`tool_start`) already turns `write/edit xd://…` into the named tool, so calls render as "Opened …",
"Read page", etc. The lookups still arrive as `read` with `path: "xd://mcp__nucode_browser_browser_navigate"`.

In `apps/nucode/src/features/messages/utils/messageRenderUtils.ts` `describeTool`: a `read` whose path
starts with `xd://` → `{ verb: "Looked up", target: <tool label>, category: "lookup" }` where the label
strips `xd://`, a leading `mcp__`, and a leading `nucode_browser_` server prefix, then humanizes
(`browser_navigate` → `browser navigate tool`). Add `"lookup"` to `ToolCategory`. `summarizeToolGroup`
must not count lookups in any part of the summary (they are bookkeeping) — a group of 1 lookup +
3 browser actions summarizes as "3 browser actions". Apply the same exclusion in
`src/features/work/WorkStepGroup.tsx`'s tally. Make sure anything that switches on `ToolCategory`
(icons, CSS classes) handles `"lookup"` (fall back to the "other" look).

Tests: `describeTool` for `read xd://mcp__nucode_browser_browser_snapshot` and a non-browser
`xd://mcp__codegraph_explore`; `summarizeToolGroup` excludes lookups; a plain `read` of a real file
still says "Read 1 file".

## 3. Panics are recorded before the process dies
`apps/nucode/src-tauri/src/diagnostics/writer.rs` `install_panic_hook` records `app.panic` through the
async writer thread; when the panic ends the process (a panic on the main thread stops tao's event loop
and the app exits with no crash report), the event is lost. Change the hook to:
- include the panicking thread's name (`std::thread::current().name()`, or "unnamed") in `detail`
  next to the existing `stack` (`file:line`); no panic message text (it can contain user data);
- after recording, flush synchronously with a bounded wait (≤ 500 ms; add a `flush_timeout`/
  `recv_timeout` variant rather than changing `flush()`'s callers), and skip the flush when the
  current thread is the `diagnostics-writer` thread itself (avoid self-deadlock);
- still call the previous hook.
Test: a unit test that installs the hook against a temp diagnostics dir, panics inside
`std::panic::catch_unwind` on a named thread, and asserts the `app.panic` event with `thread` and
`stack` is on disk immediately after (no sleep beyond the flush).

## 4. Inline the nucode browser tool docs for omp
`apps/nucode/src-tauri/src/shared/pi/profile.rs` writes omp's `config.yml` (JSON) in `prepare` for omp.
omp settings: `tools.xdevDocs` (`"catalog"` default | `"builtins"` | `"inline"`) and
`tools.xdevInlineDevices` (glob list, applies when xdevDocs is `"builtins"`); see
`node_modules/@oh-my-pi/pi-coding-agent/src/tools/settings.ts` in the installed engine
(`~/Library/Application Support/dev.nucode.desktop/engines/omp/…`) or the `engines/omp` package.
Add `"tools": {"xdevDocs": "builtins", "xdevInlineDevices": ["mcp__nucode_browser_*"]}` to that object.
Confirm from omp's settings loader that nested `tools: {xdevDocs: …}` is how dotted ids are read (adjust
the shape if not). Update/extend the existing profile/config test in `src/shared/pi/tests.rs` that
asserts the written config.

## Files
- `apps/nucode/src/features/app/hooks/useSidePanelState.ts` (+ `src/features/panels/panelState.ts` if needed) + tests
- `apps/nucode/src/features/messages/utils/messageRenderUtils.ts`, `src/features/work/WorkStepGroup.tsx`,
  any `ToolCategory` consumers + tests
- `apps/nucode/src-tauri/src/diagnostics/writer.rs` + test
- `apps/nucode/src-tauri/src/shared/pi/profile.rs`, `src/shared/pi/tests.rs`

Off-limits: `src-tauri/src/browser/`, `src-tauri/src/computer/`, `src-tauri/src/import/`, onboarding,
`docs/specs/` other than this file, dependency changes.

## Constraints
Follow surrounding style (terse, no comments that restate code). No new dependencies. Never put URLs,
page content or panic messages into diagnostics.

## Verification
From `apps/nucode`:
```
npx tsc --noEmit && npx vitest run src/features/app src/features/panels src/features/messages src/features/work
```
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib diagnostics && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib shared::pi::
```
All must pass.

## Out of scope
- Persisting browser session cookies across restarts, restoring native tabs after relaunch.
- Agent tab ownership (which native tab the agent drives) beyond item 1.
- The root cause of the observed quit (item 3 only makes the next one diagnosable).
