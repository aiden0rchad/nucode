# M10d — Import exactly the Codex Desktop threads

Follow-up to M10c (`docs/specs/m10c-match-source-apps.md`). The user's rule: **only real Codex
Desktop chat and code sessions are imported. Worker runs (e.g. "SOL WORKER" delegations) never
are.** There is no option to include them.

## Facts (read-only inspection of the user's `~/.codex`)

- `state_5.sqlite` `threads` is the list Codex Desktop shows. Relevant columns: `id`,
  `rollout_path`, `source`, `originator`, `thread_source`, `archived`, `cwd`, `name`, `title`,
  `first_user_message`, `created_at_ms`, `updated_at_ms`, `model`.
- Live Codex Desktop threads (`source` `vscode`, originator `Codex Desktop` or NULL for older
  builds, plus one `codex_work_desktop`): ~131. Only 43 still have their `rollout_path` file; the
  other ~87 exist only in `thread_history_1.sqlite`.
- `source` `exec`/`mcp` (originators `codex_exec`, `codex_sdk_ts`, `codex_cli_rs`) are worker runs.
  Rows with originator `nucode` or `codex_monitor` are old nucode test runs. Subagents have a JSON
  `source` and/or `thread_source = 'subagent'`.
- `thread_history_1.sqlite` (≈1.5 GB):
  `thread_items(thread_id, turn_id, item_id, rollout_ordinal, created_at_ms, item_json, item_type, …)`
  and `thread_turns(thread_id, turn_id, rollout_ordinal, status, started_at, completed_at, …)`.
  `item_json` is a Codex v2 `ThreadItem` — the same model nucode renders. Item types seen:
  `userMessage` (`content[].text`), `agentMessage` (`text`), `reasoning`, `commandExecution`
  (`command`, `cwd`, `aggregatedOutput`, `exitCode`, `status`), `fileChange`
  (`changes[{path, kind, diff}]`), `mcpToolCall` (`server`, `tool`, `arguments`, `result`,
  `error`), `webSearch` (`query`), `dynamicToolCall`, `imageView`, `imageGeneration`,
  `contextCompaction`, `subAgentActivity`, `collabAgentToolCall`, `sleep`, `functionCallOutput`.
  There is a partial index on `item_type = 'userMessage'`.

## Changes

### 1. The Codex list comes from Codex's thread database

- Scan Codex threads from the newest `state_<n>.sqlite` `threads` table (existing read-only
  `sqlite3 -readonly -json` helper; never open it read-write).
- Keep a row only if all hold:
  - `source` is `vscode` or `cli`;
  - `originator` is NULL/empty, `Codex Desktop`, `codex_work_desktop`, or (only with
    `source = 'cli'`) `codex_cli_rs`;
  - `thread_source` is not `subagent`;
  - not archived, unless archived chats are included (existing option).
- Rows that fail are not listed, counted or imported at all (no `automated` state).
- **Remove** the M10c `includeAutomated` option everywhere (settings field, scan/migrate params,
  Settings toggle, types, tests). Delete it outright; no compatibility shim beyond serde ignoring
  an unknown `includeAutomated` key in old settings files.
- Rollout files under `sessions/`/`archived_sessions/` that have no matching row are ignored
  (they are workers, tests or deleted threads). If no state DB exists at all, fall back to today's
  rollout scan with the same source/originator rules applied to `session_meta`.
- Title: `name` → `session_index.jsonl` `thread_name` → cleaned `first_user_message`/`title`.
  Timestamps: `created_at_ms`/`updated_at_ms`.

### 2. Content: rollout when present, otherwise Codex's history database

- If `rollout_path` exists, convert it as today.
- Otherwise read `thread_history_1.sqlite` for that thread only:
  `SELECT item_json FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal, updated_at_ordinal`
  (parameterise safely: the id must match `^[0-9a-f-]{36}$` before it goes into SQL), and convert
  items into pi entries with the existing `convert::Builder`:
  - `userMessage` → user message (text parts; images → `[image]`; apply `clean_codex_prompt`).
  - `agentMessage` → assistant text (consecutive agent/tool items share one assistant message
    until a user message, like the rollout path).
  - `commandExecution` → `bash{command}` (unwrap `/bin/zsh -lc "<cmd>"`, `bash -lc`, `sh -c`) with
    a result from `aggregatedOutput` (`isError` when `exitCode` is non-zero or status is
    `failed`/`declined`).
  - `fileChange` → one `edit`/`write` call per change, from the unified `diff` (hunk `-`/` ` lines
    → oldText, `+`/` ` lines → newText; `kind` add → `write` with the `+` lines; delete →
    `bash rm <path>`), each with a short success result.
  - `mcpToolCall` → `mcp__<server>__<tool>` with `arguments` and a result from
    `result.content` text or `error.message`.
  - `webSearch` → `web_search{query}` with result `Searched: <query>`.
  - `dynamicToolCall` → its tool name and arguments; result from `contentItems` text.
  - `imageView`/`imageGeneration` → a tool call with result `[image]`.
  - `contextCompaction` → no visible message; if it carries summary text use it as the source
    compaction (`Builder::compact`).
  - `reasoning`, `subAgentActivity`, `collabAgentToolCall`, `sleep`, `functionCallOutput`, unknown
    → skipped.
- The query output for one thread may be large: stream it (do not buffer more than the existing
  200 MB limit; a thread exceeding it is skipped with a clear reason).
- Change detection for history-only threads uses `(updated_at_ms, item count)` instead of file
  size/mtime; store them in the migration record the same way (`sourceSize`/`sourceMtime` may be
  reused or renamed — keep the record readable). `active` = `updated_at_ms` within 10 minutes.
- Move mode for history-only threads: there is no file to move; skip the move with reason
  "stored in Codex's database; left in Codex" while still importing the copy.
- Empty = no `userMessage` items (use the indexed count query once per scan, not per thread).

### 3. Claude is unchanged

Claude Desktop sessions keep the M10c rules.

## Tests (temp roots; build small SQLite fixtures with the `sqlite3` CLI in the test, like the existing zip/sqlite tests do)

1. A state DB with rows for: Desktop (file), Desktop (history only), NULL-originator Desktop,
   `exec`, `mcp`, originator `nucode`, subagent, archived Desktop → only the three Desktop rows
   are listed and imported (archived only with `includeArchived`); nothing else is counted.
2. A history-only thread converts: user prompt, agent text, command with output and exit code,
   file change → edit, MCP call, web search; the file parses with `read_imported_session` and its
   turns contain `commandExecution` and `fileChange` items; title is the row `name`.
3. A history-only thread whose `updated_at_ms` changes is regenerated when untouched and left
   alone when continued; Move skips history-only threads with the stated reason.
4. No state DB → rollout fallback with the same exclusions.
5. `includeAutomated` no longer exists (settings round-trip ignores an old key).

## Verification

```bash
cd $HOME/nucode/apps/nucode/src-tauri && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib shared::imports:: 2>&1 | tail -30
cd $HOME/nucode/apps/nucode/src-tauri && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo build --lib 2>&1 | grep -E "^(warning|error)" | sort | uniq -c
cd $HOME/nucode/apps/nucode && npm run typecheck && TMPDIR=$HOME/nucode/.tmp npx vitest run src/features/onboarding src/features/settings
```

Do not commit. Do not run the ignored real-data test.

## Out of scope

Claude import rules, the wizard and Settings layouts (other than removing the toggle), engines.
