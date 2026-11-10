# M10c — Imported chats line up with Codex and Claude

Follow-up to M10/M10b (`docs/specs/m10-chat-migration.md`, `m10b-chat-migration-fixes.md`).
A real migration showed three mismatches with what the user sees in Codex and Claude. Fix them in
`apps/nucode/src-tauri/src/import/{parse.rs,codex.rs,claude.rs,migrate.rs,convert.rs,tests.rs}`
plus the small Settings/types change below.

## Facts from a real install (read-only inspection)

- Codex `~/.codex/state_<n>.sqlite` table `threads` has `source` (`vscode` = Codex Desktop,
  `cli`, `exec`, `mcp`, or a JSON object `{"subagent":…}`), `thread_source` (`user`, `subagent`,
  `agent_forked_thread`), `title` (the raw first user message), `name` (the name Codex shows in
  its sidebar, e.g. "Notes", "Plan the launch"), `archived`, `cwd`, `project_id`
  (NULL for all rows here).
- `projects` + `project_roots` give Codex's projects, e.g. `me` → `$HOME`
  (the home folder), `Team docs` →
  `$HOME/Projects/Team docs`, `demo-app` →
  `$HOME/demo-app`.
- Rollout `session_meta.payload.source` carries the same source values; `originator` is e.g.
  `Codex Desktop`, `codex_cli_rs`, `codex_exec`, `codex_sdk_ts`.
- `exec`/`mcp` threads are runs started by other tools (scripts, the SDK, Claude Code delegating to
  Codex). Codex's sidebar does not list them. Many ran in worktree folders that no longer exist.
- Codex Desktop user messages may be wrapped like:
  ```
  # Files mentioned by the user:

  ## icon.png: /Users/x/icon.png

  ## My request for Codex:
  Prepare the repo
  ```
  and may contain `<in-app-browser-context …>…</in-app-browser-context>` blocks.
- All Claude transcripts here come from Claude Desktop's Code tab (`entrypoint: claude-desktop`),
  whose metadata `local_*.json` `title` is what Claude Desktop shows.

## Changes

### 1. Titles match the source app

- Codex: `threads.name` (non-empty) → `session_index.jsonl` `thread_name` → cleaned first prompt
  (see 4). Never the raw `threads.title`.
- Claude: Claude Desktop metadata `title` → last `custom-title` → last `summary` → cleaned first
  prompt. (Today `custom-title` wins; swap so Desktop's title wins.)

### 2. Only import what Codex lists, unless asked

- A Codex session is **interactive** when its source is `vscode` or `cli` (from the DB row if
  present, else `session_meta.payload.source`). `exec`, `mcp`, any other string, and subagents are
  **automated**. Subagents stay skipped entirely (as today).
- New scan state `"automated"`. Automated sessions are not imported unless the request has
  `includeAutomated: true`. Add `automated` to each source's counts in the scan response and keep
  them out of `chats`/`pending` when not included.
- `AppSettings.chat_import.include_automated: bool` (`includeAutomated`, default false), mirrored
  in `src/types.ts`. Auto-import passes it through. The Settings → Import "Claude & Codex chats"
  group gets a toggle "Include runs started by other tools" with subtitle "Codex runs from
  scripts, the SDK, or other agents. Codex hides these from its own list." The wizard does not
  show this toggle (it uses the saved value, default off).

### 3. Code sessions stay in Code mode, in the source app's project

Codex and Claude Code sessions are always Code-mode threads. Remove the "cwd is `$HOME` or `/` →
Chat mode" rule. Resolve the target workspace for a session `cwd` like this:

1. Candidate roots = registered nucode workspace paths ∪ Codex project roots.
2. A root equal to `$HOME` or `/` matches only exactly (never as an ancestor), so a home project
   cannot swallow other sessions.
3. If `cwd` exists: pick the deepest candidate root that equals or contains `cwd`; else `cwd` itself.
4. If `cwd` no longer exists (deleted worktree): pick the deepest candidate root that contains it
   and exists; else the nearest existing ancestor directory of `cwd` that is not `$HOME` or `/`.
   The thread header `cwd` becomes that existing root (so the engine can run), and the original
   path is recorded as `importedFrom.cwd`. Only if nothing qualifies does the session fall back
   to Chat mode (state `chatMode`).
5. A new workspace takes the Codex project name when its root is a Codex project root, otherwise
   the folder basename. Reuse an existing workspace with the same path.

`$HOME` is an ordinary project in this scheme (Codex itself has a `exampleuser` project for it).
Chat mode remains for claude.ai/ChatGPT exports and the last-resort case above.

### 4. Clean Codex Desktop wrappers

Add `clean_codex_prompt(text)` used for title fallbacks and for user messages in converted
threads:
- `# Files mentioned by the user:` blocks: output the text after `## My request for Codex:`, then a
  blank line and `Files: name (path), name (path)` built from the `## name: path` lines. If there
  is no request section, keep the text unchanged.
- Remove `<in-app-browser-context …>…</in-app-browser-context>` and
  `<environment_context>…</environment_context>` blocks.
- Trim; a message that becomes empty is dropped (as today).

## Tests (in `import/tests.rs`, temp roots only)

1. Codex `name` beats `title`; `session_index` beats first prompt; a wrapped first prompt yields
   the cleaned request as title and as the converted user message (with the `Files:` line).
2. `exec` and `mcp` rollouts are `automated` and not migrated by default; with
   `includeAutomated: true` they migrate. Counts report `automated`.
3. A Codex session with `cwd == $HOME` and a Codex project for `$HOME` lands in a Code workspace
   named after the Codex project, not in Chat mode. A later session in `$HOME/proj` gets its own
   workspace (home does not swallow it).
4. A session whose `cwd` was a deleted subfolder of a Codex project root lands in that project's
   workspace with header `cwd` = the root and `importedFrom.cwd` = the original path.
5. Claude Desktop metadata title beats `custom-title`.
6. Existing tests keep passing (update the ones that asserted the old home → chat rule).

## Verification

```bash
cd $HOME/nucode/apps/nucode/src-tauri && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib shared::imports:: 2>&1 | tail -30
cd $HOME/nucode/apps/nucode/src-tauri && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo build --lib 2>&1 | grep -E "^(warning|error)" | sort | uniq -c
cd $HOME/nucode/apps/nucode && npm run typecheck && TMPDIR=$HOME/nucode/.tmp npx vitest run src/features/onboarding src/features/settings
```

Do not commit. Do not run the ignored real-data test.

## Out of scope

Everything else, including the wizard layout and the provider step.
