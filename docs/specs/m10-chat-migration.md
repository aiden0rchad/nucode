# M10 — Bring chats over from Claude Code and Codex

## Goal

A user can move or copy their Claude Code and Codex conversations into nucode from the
setup wizard or from Settings → Import, and can opt in to automatic import of new chats.
Each imported conversation becomes a **native, continuable nucode thread** on the
workspace's pi-family engine (`omp` or `pi`), filed under the nucode project whose folder
matches the conversation's working directory (created if missing). The thread shows the
original title, the original timestamps (sorted by original recency), the user prompts,
the assistant replies, and tool calls rendered as normal nucode cards (commands as
`commandExecution`, edits/writes as `fileChange`, everything else as tool cards). The user
can type a new message in an imported thread and the configured provider/model continues it
with the imported history as context.

Done = the Rust tests and frontend checks in **Verification** pass, and the new flows work
against the user's real `~/.claude` (57 transcripts, ~2 GB) and `~/.codex` (89 rollouts,
~2.9 GB, one file is 320 MB) without loading whole files into memory.

### Background (read before coding)

- An importer already exists: `apps/nucode/src-tauri/src/import/{mod.rs,parse.rs,io.rs,tests.rs}`,
  exposed through the `import_request` Tauri command (`src-tauri/src/import_commands.rs`) and the
  daemon dispatcher (`src-tauri/src/bin/codex_monitor_daemon/rpc/dispatcher.rs`). UI:
  `apps/nucode/src/features/settings/components/sections/SettingsImportSection.tsx`.
- Today it (a) loads every transcript's full payload into memory during `detect`, (b) writes
  Codex threads as native Codex rollouts into `engines/codex-home` and Claude threads into the
  Claude ACP home, so they only continue on those engines, and (c) duplicates messages from
  Claude's `api-request-blob` rows. This milestone replaces (b) with conversion to pi-family
  sessions, makes reading streaming/metadata-first, and adds the migration flow.
- pi-family session files: `<data>/<profile>/sessions/<workspaceId>/<threadId>.jsonl`, where
  `<profile>` is `omp` or `pi` (see `PiEngine::directory` in `src-tauri/src/shared/pi/mod.rs`).
  The thread list is built by `read_session` in the same file, which follows `parentId` from the
  last entry, uses the header `title` as the thread name, the first user message as preview, and
  the file mtime as `updatedAt`. History rendering is `Translator::history` in
  `src-tauri/src/shared/pi/translate.rs` (`bash` → commandExecution, `write`/`edit` →
  fileChange, `mcp__*` → mcpToolCall, others → dynamicToolCall, `compaction` entry →
  contextCompaction).
- Real session file written by nucode (header line, then entries):
  ```json
  {"type":"session","version":3,"id":"<uuid>","cwd":"/abs/folder","timestamp":"2026-10-30T07:48:04Z","engine":"omp","modelProvider":"setup-14ac82be-7a1","model":"GPT 6.1 Sol (Account 2)","title":"…"}
  {"type":"message","id":"b41b0756","parentId":null,"timestamp":"…","message":{"role":"user","content":[{"type":"text","text":"…"}],"timestamp":1793346485637}}
  {"type":"message","id":"18195d48","parentId":"b41b0756","timestamp":"…","message":{"role":"assistant","content":[{"type":"text","text":"…"},{"type":"toolCall","id":"call_x","name":"bash","arguments":{"command":"ls"}}],"api":"openai-responses","provider":"imported","model":"imported/claude-sonnet-5-5","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"toolUse","timestamp":1793346485685}}
  {"type":"message","id":"be189835","parentId":"18195d48","timestamp":"…","message":{"role":"toolResult","toolCallId":"call_x","toolName":"bash","content":[{"type":"text","text":"…"}],"details":{},"isError":false,"timestamp":1793346629419}}
  {"type":"compaction","id":"0efc8074","parentId":"be189835","timestamp":"…","summary":"…","firstKeptEntryId":"<id of an earlier user message entry>","tokensBefore":123456}
  ```
  pi builds model context from the latest `compaction` entry: its `summary`, then entries from
  `firstKeptEntryId` up to the compaction, then entries after it.
- pi tool argument shapes: `bash {command}`, `read {path, offset?, limit?}`,
  `write {path, content}`, `edit {path, edits:[{oldText,newText}]}`,
  `grep {pattern, path?, glob?}`, `find {pattern, path?}`, `ls {path?}`.

## Files

Create:
- `apps/nucode/src-tauri/src/import/convert.rs` — shared pi-entry builder (ids, parent chain,
  caps, tool-call/result pairing, context-budget compaction, header).
- `apps/nucode/src-tauri/src/import/claude.rs` — Claude Code transcript scan + conversion.
- `apps/nucode/src-tauri/src/import/codex.rs` — Codex rollout scan + conversion.
- `apps/nucode/src-tauri/src/import/migrate.rs` — `scan` / `migrate` / auto-import orchestration,
  migration state, move-to-Trash, undo of moves.

Modify:
- `apps/nucode/src-tauri/src/import/{mod.rs,parse.rs,io.rs,tests.rs}`
- `apps/nucode/src-tauri/src/shared/pi/mod.rs` — only to expose `read_session` (e.g. a
  `pub(crate)` wrapper) for verification and tests. No behaviour change.
- `apps/nucode/src-tauri/src/types.rs` — `AppSettings.chat_import` (see below).
- `apps/nucode/src-tauri/src/lib.rs` — start the auto-import loop.
- `apps/nucode/src/types.ts`, `apps/nucode/src/services/events.ts` (and `tauri.ts` only if needed)
- `apps/nucode/src/features/settings/components/sections/SettingsImportSection.tsx` (+ its css)
- `apps/nucode/src/features/onboarding/{SetupWizard.tsx,setupState.ts,onboarding.css}` and their tests
- `apps/nucode/src/dev/uiPreview/handler.ts` — mock `scan`, `migrate`, `autoStatus` so the
  `npm run preview:ui` harness renders the new UI with realistic counts.

Off-limits: anything under `engines/`, `packages/protocol`, other settings sections, the Work
mode Cowork import path (`kind == "work"` keeps today's behaviour), provider/model settings.
Never read or write `~/.claude`, `~/.codex` or `~/Library/Application Support/Claude` in tests —
tests use temp roots via `Imports::with_roots` (extend `Roots` with a Trash directory).

## Behaviour

### Sources and scanning (`import_request` action `"scan"`)

Params: `{ sources?: ["claude","codex"], includeArchived?: bool }`. Returns
```ts
{ sources: { source: "claude"|"codex"; chats: number; projects: number; alreadyImported: number; pending: number; archived: number }[],
  sessions: { key: string; source: "claude"|"codex"; title: string; cwd: string; project: string;
              updatedAt: number; archived: boolean;
              state: "new"|"updated"|"current"|"continued"|"active"|"empty"|"duplicate"|"chatMode" }[],
  warnings: string[] }
```
Metadata only: stream files line by line (add a streaming JSONL reader to `io.rs`; skip, don't
fail on, malformed lines; the 200 MB whole-file limit does not apply to streaming reads; cap any
single line at 64 MB and skip longer ones). Never keep message payloads in the catalog.

Claude Code (`~/.claude/projects/*/<sessionId>.jsonl`, depth 1 only — never `*/<id>/subagents/`):
- cwd: first row with a `cwd`. Title: last `custom-title` row's `customTitle`, else the Claude
  Desktop metadata title (`~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json`
  with matching `cliSessionId`/`sessionId`, which also supplies `isArchived`), else the last
  `summary` row's `summary`, else the first human prompt's first line (≤ 80 chars).
- `updatedAt`: last row `timestamp` (fall back to file mtime). Empty = no human prompt.

Codex (`~/.codex/sessions/**/rollout-*.jsonl` and `archived_sessions/**`):
- id/cwd from `session_meta.payload`; title from the newest `state_*.sqlite` `threads`
  (existing read-only sqlite3 query in `parse.rs`), then `session_index.jsonl` `thread_name`,
  then first user prompt.
- Skip subagent rollouts (`session_meta.payload.source` is an object containing `subagent`, or a
  `thread_source`/`source` string equal to `subagent`).
- `duplicate`: the rollout's id appears as `imported_thread_id` in
  `~/.codex/external_agent_session_imports.json` and its `source_path` is a Claude transcript that
  is also selected — import the Claude original only.

States: `active` = source modified < 10 minutes ago; `chatMode` = cwd missing on disk, or cwd is
`$HOME` or `/` (these are imported as Chat-mode conversations, see below); `current`/`updated`/
`continued` come from migration state (below).

### Migration (`import_request` action `"migrate"`)

Params: `{ mode: "copy"|"move", sources?: [...], includeArchived?: bool, keys?: string[] }`
(`keys` absent = every session in the last scan that is `new` or `updated`). Requires a prior
scan in this process; otherwise scan first. Reports progress through the existing
`status`/`cancel` actions and returns the existing `Log` shape (created receipts, skipped
`"<title>: <reason>"` strings, warnings), saved under `imports/` so the existing history list and
Undo work.

Per session:
1. **Target.** Workspace = exact path match in the registry, else the deepest registered
   workspace whose path is an ancestor of cwd, else a new `WorkspaceEntry` named after the folder
   basename (same mechanics as today's `prepare`). Profile = workspace `settings.defaultEngine`
   if `omp`/`pi`, else `agentPolicy.defaultEngine` if `omp`/`pi`, else `pi`. File =
   `<data>/<profile>/sessions/<workspaceId>/<threadId>.jsonl`, new UUIDv4 thread id.
   `chatMode` sessions go to `<data>/chats/sessions/chats/<threadId>.jsonl` with cwd
   `<data>/chats/scratch/<threadId>` (created), like `pi_session` does today.
2. **Convert** (rules below), write with `write_new` semantics (0600, create_new, fsync) to a temp
   name in the same directory and rename into place; set the file mtime to the source's last
   timestamp (`std::fs::File::set_modified`).
3. **Verify** by parsing the written file with the pi engine's `read_session`; on failure delete
   it and skip with the error.
4. **Record** in `imports/migrations.json`:
   `{ "<key>": { threadId, workspaceId, profile, file (relative to data), fileHash, sourcePath, sourceSize, sourceMtime, logId } }`.
5. **Updated sources.** If a key is already recorded and the source size/mtime changed: when the
   recorded file's current hash still equals `fileHash` (not continued in nucode), regenerate it
   in place (same thread id and path) and update the record (`updated`); otherwise skip with
   "continued in nucode; left as is" (`continued`). Unchanged sources are `current` and skipped.
6. **Move mode.** After 2–4 succeed (or the session is already `current`), move the source to the
   Trash: Claude → the transcript plus a sibling `<sessionId>/` directory if present, plus the
   matching Claude Desktop `local_*.json` metadata file; Codex → the rollout file. Rename into
   `~/.Trash` (configurable root for tests), adding ` <n>` before the extension on name clashes.
   Record original → trashed paths in the receipt. Never move `active` sessions (skip "in use;
   try again when it has been idle for 10 minutes"). Never edit other apps' databases or index
   files.
7. **Undo** (existing `undo` action) additionally restores trashed sources to their original
   paths when the original path is free, removes the migration records of that log, and deletes
   thread files whose hash still matches the record (otherwise the existing `needsConfirmation`
   flow applies).

### Conversion rules (`convert.rs` + per-source modules)

Common:
- Header: `type:"session"`, `version:3`, `id`, `cwd`, `timestamp` = first source timestamp,
  `engine` = profile, `modelProvider`/`model` = `agentPolicy.defaultModel` (omit if unset),
  `title`, `importedFrom: {source, sessionId, path}`.
- Entry ids: 8 lowercase hex chars, unique per file; each entry's `parentId` is the previous
  entry's id (first is `null`); `timestamp` = source row timestamp (RFC 3339), message
  `timestamp` = same in ms.
- Assistant messages: `api:"openai-responses"`, `provider:"imported"`,
  `model:"imported/<source model or source name>"`, zero `usage`, `stopReason` = `"toolUse"` if
  it contains a toolCall else `"stop"`. Drop thinking/reasoning blocks entirely.
- Tool call ids: keep the source id, replacing chars outside `[A-Za-z0-9_-]` with `_`, max 64
  chars, unique per file.
- Every toolCall gets exactly one toolResult before the next user/assistant message; synthesize
  `{"isError":true, text:"No result was recorded for this call (imported)."}` when missing; drop
  orphan results.
- Caps: tool result text ≤ 16 KiB (first 12 KiB + `\n[… N characters omitted …]\n` + last 4 KiB);
  `write.content` and other string arguments ≤ 64 KiB with the same marker; any single text block
  ≤ 256 KiB. Images become the text `[image]`.
- Context budget: estimate tokens as chars/4 over the entries pi would send. If the estimate
  exceeds 100k tokens, or the source contains a compaction, append a final `compaction` entry:
  `summary` = `"Imported from <Claude Code|Codex>. Summary of the earlier conversation:\n"` + (the
  latest source compaction summary, if any) + a digest of the messages between that point and the
  kept tail built like `continuation()` (role: text lines, head/tail trimmed to ≤ 24k chars);
  `firstKeptEntryId` = the id of the user-message entry starting the longest suffix that fits in
  60k tokens (at minimum the last user message); `tokensBefore` = the estimate.

Claude Code transcript rows:
- Follow the current branch: start at the last row with a `uuid` (prefer `last-prompt.leafUuid`
  when present) and walk `parentUuid` back; ignore rows not on that chain. Skip `isSidechain`.
- Only `type:"user"` and `type:"assistant"` rows carry conversation; ignore `api-request*`,
  `attachment`, `queue-operation`, `file-history-*`, `system`, `tools-used`, `atis-latch`,
  `relocated`, `last-prompt`, `custom-title`, `agent-name` and unknown types.
- Human prompts: user rows whose `message.content` is a string or text blocks, not `isMeta`,
  not `isCompactSummary`. Strip `<system-reminder>…</system-reminder>`, `<local-command-caveat>…`,
  `<command-name>`/`<command-message>`/`<command-args>` wrappers (keep the command text, e.g.
  `/review`), drop `<local-command-stdout>` blocks; drop the message if nothing remains.
- `isCompactSummary` user rows: not shown; remember the latest text as the source compaction.
- Assistant rows: consecutive rows with the same `message.id` form ONE assistant message (blocks
  appended in order). `text` → text; `tool_use` → toolCall; `thinking`/`redacted_thinking` dropped.
- `tool_result` blocks in user rows → toolResult (`is_error` → `isError`; content string or
  text blocks; images → `[image]`).
- Tool mapping: `Bash{command}`→`bash{command}`; `Read{file_path,offset,limit}`→`read{path,offset,limit}`;
  `Write{file_path,content}`→`write{path,content}`; `Edit{file_path,old_string,new_string}`→
  `edit{path,edits:[{oldText,newText}]}`; `MultiEdit{file_path,edits}`→`edit{path,edits}`;
  `Grep{pattern,path,glob}`→`grep`; `Glob{pattern,path}`→`find`; `LS{path}`→`ls`;
  `mcp__*` unchanged; anything else keeps its name and input.

Codex rollout rows:
- User prompts: `event_msg` `user_message.message`, and `event_msg` `item_completed` whose
  `item.type == "UserMessage"` (text parts). De-duplicate identical consecutive prompts. Ignore
  `response_item` messages with role `user`/`developer`/`system` (they carry injected AGENTS.md,
  environment and instructions).
- Assistant text: `response_item` `message` role `assistant`, `output_text` parts. Consecutive
  assistant items with no user prompt between them may share one assistant message until a tool
  result intervenes (then start a new assistant message).
- Tool calls: `function_call` (`arguments` JSON string), `custom_tool_call` (`input` string),
  `local_shell_call` (`action.command` array). Results: `function_call_output` /
  `custom_tool_call_output` (`output` may be a string, a JSON string with an `output` field, or an
  array of `input_text` parts), matched by `call_id`.
- Tool mapping: `shell`/`container.exec`/`local_shell_call` (`command` array) → `bash{command}`
  (shell-join; unwrap `["bash","-lc",cmd]`); `exec_command{cmd}` → `bash{command}`;
  `apply_patch` → one `edit`/`write` toolCall per file from the patch (`*** Add File` → write with
  the `+` lines; `*** Update File` → edit whose oldText/newText are each hunk's context+`-` and
  context+`+` lines; `*** Delete File` → `bash{command:"rm <path>"}`), each paired with the same
  output text; everything else (e.g. the JS `exec` tool, `web_search_call`, `view_image`) keeps
  its name with arguments `{input}` or the parsed JSON.
- `compacted` items (`payload.message`): remember as the source compaction.
- Skip `reasoning`, `token_count`, `turn_context`, `world_state`, `token_usage_record`,
  `additional_tools` and unknown types.

### Automatic import

- `AppSettings.chat_import` (`#[serde(default, rename = "chatImport")]`):
  `{ auto: bool (default false), sources: Vec<String> (default ["claude","codex"]), includeArchived: bool (default false) }`.
  Mirror it in `src/types.ts` as optional `chatImport?: { auto: boolean; sources: ("claude"|"codex")[]; includeArchived: boolean }`.
- In the desktop app (not the daemon, not in remote mode): 20 s after launch and then every
  15 minutes, if `chatImport.auto` and the `importTools` feature are on, run `scan` + `migrate`
  with `mode:"copy"` for `new`/`updated` sessions that are not `active`, through
  `Imports::request` so the registry locks are respected. Skip silently if another import is
  running. Keep `{lastRunAt, imported, skipped, error}` in memory, readable via
  `import_request` action `"autoStatus"`. After a run that created or updated threads, emit a
  Tauri event `nucode://imports-changed`; the frontend forwards it to `notifyImportsChanged()`
  so thread lists and projects refresh.

### Settings UI (Settings → Import)

Add a first group **"Claude & Codex chats"** above the existing controls (keep the existing
detect/export/history UI below it in a group titled **"Advanced import"**):
- On open, run `scan` and show one row per source: "Claude Code — 57 chats in 12 folders · 0 in
  nucode" / "Codex — …", each with a toggle to include that source. Rows with zero chats say
  "None found on this Mac".
- "When bringing chats over": two-option choice (segmented control or radio, using existing
  settings primitives): **Copy** — "Keep the originals in Claude and Codex." (default) and
  **Move** — "Send the originals to the Trash after nucode verifies its copy."
- Toggle "Include archived chats".
- Primary button **"Bring chats over (N)"**; while running show the existing progress bar and
  Cancel; afterwards a summary "Brought over 120 chats into 14 projects. 6 skipped." with the
  skipped reasons in a collapsible list and an **Undo** button for that import.
- Toggle **"Bring in new chats automatically"** with help text "Checks on launch and every
  15 minutes. Always copies and never touches the originals. Chats used in the last 10 minutes
  wait until they're idle." plus a status line from `autoStatus` ("Last checked 3 minutes ago ·
  2 new chats").
- Persist toggles through the normal app-settings update path (`chatImport`).

### Setup wizard

Add a step `chats` between `project` and `features` (update `steps`, `titles`, `descriptions`,
progress rail). Title "Bring your chats." Description "Copy your Claude Code and Codex
conversations into nucode, organised by project." Hidden when the `importTools` feature is off.
- Runs `scan` when shown; shows a loading state, then per-source counts as in Settings.
- Copy/Move choice (Copy default) and "Keep bringing in new chats automatically" (default on;
  saved to `chatImport.auto`).
- Primary **"Bring them over"** runs `migrate`, shows progress, then a one-line result and
  advances (marking the step completed). Secondary **"Skip"** marks it skipped.
- Nothing found → "No Claude Code or Codex chats were found on this Mac." with **Continue**.
- Follow the existing wizard styles, motion and focus handling; no new colours or fonts.

## Constraints

- No new crates or npm packages (Codex runs offline). Use `std::fs::File::set_modified`, `uuid`,
  `serde_json`, `sha2`, `chrono` already in the tree.
- All source reads go through `io::safe` (credential and symlink guards stay). Blocking I/O runs
  on the existing blocking worker inside `Imports::request`; never on the UI executor.
- Keep the existing code style: compact Rust using `serde_json::json!` values, small functions,
  `Result<_, String>` errors with user-readable messages. Keep `mod.rs` from growing further —
  new logic goes in the new modules.
- Remove the native Codex-rollout and Claude-ACP write paths in `prepare`; Claude/Codex thread
  entries from the advanced picker must also go through the new converter. Update the existing
  tests that asserted the old paths. MCP connector, project, export-file and Cowork imports keep
  their current behaviour.
- Frontend: TypeScript strict, existing design-system primitives
  (`SettingsPrimitives`, `ModalShell`), no inline colours.

## Verification

Run from the repo root; all must pass:

```bash
cd $HOME/nucode/apps/nucode/src-tauri && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib import:: 2>&1 | tail -30
cd $HOME/nucode/apps/nucode/src-tauri && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib shared::pi:: 2>&1 | tail -15
cd $HOME/nucode/apps/nucode && npm run typecheck && npx vitest run src/features/onboarding src/features/settings
```

New Rust tests (in `import/tests.rs` or module tests) must cover, with fixture files in temp roots:
1. Claude: multi-row assistant message merged by `message.id`; `api-request-blob`, `isMeta`,
   `attachment` and system-reminder text not imported; branch selection via `parentUuid`
   (an abandoned branch is absent); tool_use/tool_result → bash/edit/write with results;
   `custom-title` used as the name; `isCompactSummary` produces a final compaction entry.
2. Codex: injected AGENTS.md/environment user messages absent; `event_msg` user prompts present;
   `exec_command` → bash with output; `apply_patch` with Add/Update/Delete → write/edit/bash;
   reasoning dropped; subagent rollout skipped; `compacted` → compaction entry.
3. Every generated file parses with the pi engine's `read_session`; the resulting thread has the
   right `name`, `preview`, `cwd`, `updatedAt` = source last timestamp, and its turns contain
   `commandExecution` and `fileChange` items.
4. Context budget: a transcript > 100k estimated tokens gets a compaction whose
   `firstKeptEntryId` points at a user message entry.
5. Migration: workspace matching (exact, ancestor, created); `$HOME`/missing folder → chat mode;
   re-run is idempotent; grown source regenerates an untouched copy and leaves a continued copy;
   move sends sources (and the Claude sidecar dir) to the test Trash; `active` sources are not
   moved; Undo restores trashed files and removes unmodified threads.
6. Streaming: a > 200 MB-equivalent case is not required, but the scan path must not call the
   whole-file reader for transcripts (assert via the existing `OPENS` test hook or a reader
   counter).

## Out of scope

- Claude subagent transcripts (`<id>/subagents/*.jsonl`) and Codex subagent rollouts.
- Preserving images (placeholder text only) and thinking/reasoning content.
- Editing Claude's or Codex's own databases, indexes or settings.
- Auto-import in the daemon or in remote-backend mode.
- Any change to provider/model settings, engines, or the Work-mode Cowork import.
