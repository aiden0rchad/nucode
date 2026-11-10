# M10b — Chat migration review fixes

Follow-up to `docs/specs/m10-chat-migration.md`. The uncommitted M10 implementation on
`feat/chat-migration` is accepted except for the issues below. Fix them in place.

## 1. Scanning must not hold registry locks or block on running imports

`Imports::request` takes the `workspaces` and `settings` mutexes for every action except
`status`/`cancel`/`autoStatus`, so `scan` (≈1.8 GB of JSONL in one real install) and the
15-minute auto run freeze every other command that needs those locks (workspace list, settings
saves). Also, a scan that starts while another import holds the `operation` lock fails with
"An import operation is already running", e.g. when the user opens the wizard while an auto run
is in progress.

- `scan` runs on a blocking worker **without** the registry locks and **without** the
  `operation` try-lock. Serialize scans with their own async mutex that waits (`lock().await`).
- `auto`: when `chatImport.auto` is off, the `importTools` feature is off, or the backend is
  remote, return immediately without taking any lock (read settings with a short lock and drop
  it). Otherwise scan without registry locks; only if some session is `new`/`updated`/`chatMode`
  and not `active`, take the `operation` try-lock (skip this round silently if busy) and the
  registry locks for `migrate`.
- `migrate` keeps today's locking.

## 2. Cache scan metadata

Add an in-memory cache in `Imports` keyed by source path → `(size, mtime_ms, Session)`.
`claude::scan` and the Codex scan reuse the cached `Session` (title, cwd, timestamps, `empty`,
`id`, subagent skip result) when size and mtime are unchanged, and only stream changed or new
files. Claude Desktop metadata (`claude-code-sessions/**/local_*.json`) and the Codex sqlite /
`session_index.jsonl` titles are re-read every scan (they are small) and applied on top of the
cached metadata, so renames and archival still show up. States are recomputed every scan.
A second scan of unchanged sources must not call `io::stream` on any transcript (test it with a
counter).

## 3. Move to the macOS Trash through the system API

Renaming into `~/.Trash` can fail with `EPERM` under macOS privacy protection and bypasses
Finder's "Put Back". On macOS (non-test builds) move each source with
`NSFileManager.defaultManager.trashItemAtURL:resultingItemURL:error:` via `objc2` (enable the
needed `objc2-foundation` features — `NSFileManager`, `NSURL`, `NSError` — on the existing
dependency; no new crates). Record the resulting URL's path in `receipt.trashed`. Keep the
current rename-into-`roots.trash` path for tests (`#[cfg(test)]`) and non-macOS targets.
`restore_migrations` must accept trashed paths that the system API returned (they live under
`~/.Trash` or a volume's `.Trashes`); validate with the original-root allowlist as today and
require that the trashed path exists and is not a symlink.

## 4. Undo must see pi-family threads in every profile

`has_history` only checks `pi/sessions/<workspace>` and `claude/<workspace>/threads`, so undoing
a migration can remove a created workspace that has newer `omp` threads. Check
`omp/sessions/<workspace>` and `pi/sessions/<workspace>` (any `.jsonl`), plus the existing
locations. Add a test: migrate into an `omp` workspace, create another `.jsonl` there, undo —
the workspace stays.

## 5. Tool calls that never produce an output item

Codex `web_search_call` (and any call type that has no `*_output` row) currently gets the
synthesized error result "No result was recorded…", which renders as a failed tool card. For
`web_search_call` push an immediate non-error result whose text is the search query/action
summary (e.g. `Searched: <query>`). Keep the synthesized error only for calls that should have had
an output (function/custom/local shell calls) and never got one.

## 6. Real-data dry run as an ignored test

Add `#[test] #[ignore]` `real_sources_dry_run` in `import/tests.rs`: when the environment variable
`NUCODE_IMPORT_REAL=1` is set, use `Roots::local()` with a **temporary** data directory (and a
temporary Trash root), run `scan` then `migrate` in copy mode for all non-active sessions, assert
every written file parses with `read_imported_session`, and print: per-source counts, skipped
reasons grouped with counts, scan time, second (cached) scan time, migrate time, total bytes
written, the 5 largest generated files with their entry counts. It must never write outside the
temp directories. Do not run it yourself (the sandbox may block reading `~/.claude`); just make
sure it compiles.

## Verification

```bash
cd $HOME/nucode/apps/nucode/src-tauri && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib shared::imports:: 2>&1 | tail -30
cd $HOME/nucode/apps/nucode/src-tauri && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo build --lib 2>&1 | grep -E "^(warning|error)" | sort | uniq -c
cd $HOME/nucode/apps/nucode && npm run typecheck && TMPDIR=$HOME/nucode/.tmp npx vitest run src/features/onboarding src/features/settings
```

No new warnings from the import module. Do not commit.

## Out of scope

Everything not listed above. Do not restructure the M10 code beyond what these fixes need.
