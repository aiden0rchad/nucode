# M27 — Context breakdown on the session rail, `/context-size` and `/autocompact`

## Goal

The Code-mode session rail's **Context** section today shows only the last exchange's
input / cached / output tokens. Make it show what fills the context window, the way a
"context" panel does in other agent apps:

```
Context
62% used                                   309.9k / 500k
[■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■   ] stacked bar, one colour per row
■ Messages              238.7k   47.7%
■ MCP tools              24.4k    4.9%
■ System tools           21.2k    4.2%
■ System prompt          12.9k    2.6%
■ Skills                  6.5k    1.3%
■ Memory files            2.5k    0.5%
■ Autocompact buffer       33k    6.6%
■ Free space            157.1k   31.4%
■ MCP tools (deferred)   65.9k       —
■ System tools (deferred)25.5k       —
> MCP tools                       162      (disclosure: tool names)
> Skills                            7      (existing disclosure, keep)
> Memory files                      3      (existing disclosure, keep)
150k until auto-compact            [Compact session]
```

and add two composer commands:

- `/context-size <size>` — set the context window nucode assumes for the model the current
  thread uses (e.g. `/context-size 400k`, `/context-size 1m`, `/context-size default`).
- `/autocompact <percent|on|off>` — choose how full the context gets before pi compacts
  automatically (e.g. `/autocompact 80`), or turn automatic compaction off/on. `/autocompact`
  with no argument reports the current setting.

Done means: on the pi engine (and omp if it shares the path, see below) the rail shows the
breakdown after the first turn and updates after each turn and after compaction; the two
commands persist to app settings, reach pi's generated `settings.json` / `models.json`, and the
rail's "until auto-compact" figure follows them. Engines that don't report a breakdown (codex,
ACP) keep today's rail exactly as it is.

## Design (settled — don't redesign)

### 1. Measure in the pi extension (`apps/nucode/engines/pi/extensions/`)

New pure module `lib/contextReport.ts` (no pi imports, unit-testable with `node --test`):

```ts
export type ContextReport = {
  window: number; used: number | null; reserve: number; autoCompact: boolean;
  rows: { id: "messages"|"mcpTools"|"systemTools"|"systemPrompt"|"skills"|"memory"|"buffer"|"free"; tokens: number | null }[];
  deferred: { id: "mcpTools"|"systemTools"; tokens: number }[];
  mcpTools: string[];            // declared MCP tool names, sorted
  untilCompact: number | null;   // null when auto-compaction is off or used is unknown
};
export function contextReport(input: {
  systemPrompt: string; contextFiles: { content: string }[]; skills: { name: string; description?: string }[];
  tools: { name: string; description?: string; parameters?: unknown; exposure: string; namespace?: { name: string } }[];
  activeTools: string[]; usedTokens: number | null; window: number; reserve: number; autoCompact: boolean;
}): ContextReport
```

Rules: `est(s) = Math.ceil(s.length / 4)`. `memory = Σ est(file.content)`. `skills = Σ est(name + " " + description)`.
`systemPrompt = max(0, est(systemPrompt) − memory − skills)`. A tool's cost is
`est(JSON.stringify({name, description, parameters}))`. A tool is **MCP** when its
`namespace?.name` or its `name` starts with `mcp__`; otherwise **system**. Declared = name in
`activeTools`; tools that are not active and whose exposure is `codemode` or `deferred` go in
`deferred` (summed per kind); `hidden` tools are ignored. `fixed` = systemPrompt + memory + skills +
declared MCP + declared system. When `usedTokens` is a number: `messages = max(0, usedTokens − fixed)`
and `used = messages + fixed`; when null, `messages` and `used` are null. `buffer = autoCompact ? reserve : 0`.
`free = used === null ? null : max(0, window − used − buffer)`.
`untilCompact = autoCompact && used !== null ? max(0, window − reserve − used) : null`.

Wire it in `nucode-gate.ts` (it loads in every pi mode): on `before_agent_start` keep the event's
`systemPrompt`, `systemPromptOptions.contextFiles` and `systemPromptOptions.skills`. On `turn_end`,
`agent_end` and `session_compact`, if a system prompt has been captured, build the report with
`pi.getAllTools()`, `pi.getActiveTools()`, `ctx.getContextUsage()` (`tokens`, `contextWindow`), and
the effective compaction settings from `pi.getSettings()`:
`enabled = settings.compaction?.enabled !== false`,
`reserve = settings.compaction?.modelOverrides?.[`${ctx.model.provider}/${ctx.model.id}`]?.reserveTokens ?? settings.compaction?.reserveTokens ?? 16384`.
Send it with `ctx.ui.setStatus("nucode-context", JSON.stringify(report))`. Never throw from these
handlers (wrap in try/catch and skip on error).

### 2. Route it in Rust

- `apps/nucode/src-tauri/src/shared/pi/process.rs`: the existing branch that turns
  `setStatus` JSON for `nucode-verification` / `nucode-execution-limit` into translator events —
  add `nucode-context` → translator kind `nucode_context`.
- `apps/nucode/src-tauri/src/shared/pi/translate.rs`: handle `nucode_context` by emitting
  `thread/context/updated` with params `{ "threadId": <thread>, "context": <record> }`.

### 3. Show it in the frontend

- Follow how `thread/tokenUsage/updated` reaches `ThreadTokenUsage` and the rail's `usage` prop
  (`apps/nucode/src/features/session/CodeSessionRail.tsx`, `useCodeSessionData.ts`, the thread
  event handlers/reducer). Store the latest `context` per thread the same way; add a `ContextReport`
  type to `apps/nucode/src/types.ts`; pass `contextReport: ContextReport | null` and
  `onCompact: () => void` to `CodeSessionRail`.
- When `contextReport` is present, the Context section renders the layout in the Goal: header row
  `"{percent}% used"` + `"{used} / {window}"`; stacked bar of the rows (except free space, which is
  the empty remainder); one row per `rows` entry with a coloured square, `formatK(tokens)` and
  percent of `window` (one decimal); then the `deferred` rows with "—" for percent; a nested
  disclosure "MCP tools" listing `mcpTools` (reuse `code-session-nested`); keep the existing Skills
  and Memory files disclosures; footer `"{formatK(untilCompact)} until auto-compact"` (or
  "Auto-compact is off" when `autoCompact` is false) and a **Compact session** button that calls
  `onCompact`, wired to the same action `/compact` uses. `formatK`: under 1000 → as is; else one
  decimal + "k", dropping ".0" (33000 → "33k"); ≥1,000,000 → "m". Unknown values show "—". The rail
  header meter and section header value use the report's percent when present.
- Colours: add CSS custom properties in `code-session-rail.css` next to the existing
  `data-kind` colours — messages blue, MCP tools orange, system tools teal, system prompt amber,
  skills/memory/buffer neutral greys of different lightness, free space transparent with a border.
  Use the existing theme tokens where the file already does; no hard-coded light-only colours.
- When `contextReport` is null, render exactly what renders today.

### 4. Settings and the two commands

- `apps/nucode/src-tauri/src/types.rs` / `apps/nucode/src/types.ts`: add to `AppSettings`
  `autoCompact: { enabled: bool, percent: Option<u8> }` (serde `rename = "autoCompact"`, default
  `{ enabled: true, percent: None }`, missing in old files → default). `percent` valid 50..=95.
  `/context-size` writes the existing per-model `contextWindow` field (`ProviderModel.contextWindow` /
  `context_window`) of the thread's provider + model; `default` clears it (None). Valid range
  8,000..=10,000,000.
- `apps/nucode/src-tauri/src/shared/pi/config.rs`: when writing pi's `settings.json`, add
  `"compaction": {"enabled": <enabled>}` and, when `percent` is Some, `"modelOverrides"` with one
  entry per enabled model that has a known context window: key `"{provider_id}/{model_id}"` (same
  form as `enabledModels`), value `{"reserveTokens": max(1024, window − floor(window × percent / 100))}`.
  `models.json` already carries `contextWindow`; no change there beyond what the setting field implies.
  If omp is configured through the same `config.rs` home, it gets the same keys; if omp uses a
  different settings writer, leave omp alone and say so in your report.
- Settings must reach running pi sessions the way provider/model edits already do. Find that path
  (`PiEngine::configure` and how it restarts or reloads idle processes) and reuse it; if new values
  only apply to newly started pi processes, keep it that way and say so in the command's reply.
- Composer: add `context-size` and `autocompact` to `basicCommands`
  (`apps/nucode/src/features/composer/commands.ts`) with short descriptions, and handle them in
  `useQueuedSend.ts` `runSlashCommand` next to `compact`/`status`. Parse sizes like `200000`,
  `200k`, `1m`, `1.5m` (case-insensitive). Save through the same app-settings update function the
  Settings screen uses. Reply with a local status item the same way `/status`
  (`startStatus` in `useThreadMessaging.ts`) posts its lines, e.g.
  `Context size for GPT 6.1 Sol set to 400k (was 272k). Applies from the next turn.`,
  `Auto-compact at 80% of the context window.`, `Auto-compact is off.`, and on bad input a one-line
  usage hint. `/autocompact` alone reports the current setting.

## Files

- New: `apps/nucode/engines/pi/extensions/lib/contextReport.ts`,
  `apps/nucode/engines/pi/tests/contextReport.test.ts`.
- Modify: `engines/pi/extensions/nucode-gate.ts`; if extension files are embedded with
  `include_str!` in `src-tauri/src/shared/pi/config.rs`, add the new lib file to that list.
- Modify: `src-tauri/src/shared/pi/{process,translate,config}.rs`, `src-tauri/src/types.rs` and the
  Rust tests beside them (`shared/pi/tests.rs`).
- Modify: `src/types.ts`, `src/features/session/{CodeSessionRail.tsx,useCodeSessionData.ts,code-session-rail.css,CodeSessionRail.test.tsx}`,
  the thread event handler/reducer files that carry `tokenUsage`, `src/features/app/components/MainApp.tsx`
  (props), `src/features/composer/commands.ts`, `src/features/threads/hooks/useQueuedSend.ts` (+ its test),
  and any settings default/fixture objects that typecheck requires.
- Off-limits: generated `packages/protocol`, codex/ACP engines, `window_layout.rs`, diagnostics.

## Constraints

- Match surrounding style (dense Rust, `Result<_, String>`; existing React patterns and CSS
  conventions in the rail). No new dependencies.
- Public repository: no personal names, home paths, hostnames or real model/provider names in
  tests — use neutral ids like `provider-a/model-b`.
- Commit nothing; leave changes in the working tree.

## Verification

From the worktree root (`TMPDIR` inside it):

```
mkdir -p .tmp
( cd apps/nucode/engines/pi && npm test )
( cd apps/nucode/src-tauri && TMPDIR="$PWD/../../../.tmp" cargo test --lib -- shared::pi types storage settings )
( cd apps/nucode && npm run typecheck && npx vitest run src/features/session src/features/composer src/features/threads src/features/app )
```

Required new tests: `contextReport` (MCP/system split, deferred and hidden tools, unknown usage,
auto-compact off, `untilCompact` maths); config.rs writes `compaction.enabled` and the
`modelOverrides` reserve for a percent; translator turns a `nucode_context` record into
`thread/context/updated`; the rail renders rows, deferred rows, "until auto-compact" and calls
`onCompact`, and renders today's view when the report is null; size parsing and both commands'
replies. Known sandbox-only failures (tests that bind localhost or run `/bin/ps`): report, don't fix.
If a Swift build script fails with "precompiled file … module cache path", run
`cargo clean -p apple-cf -p apple-metal -p screencapturekit` in `apps/nucode/src-tauri` once and retry.

## Out of scope

- Codex/ACP breakdowns; a Settings-screen UI for these values; changing `keepRecentTokens`;
  exact tokenizer counts (the 4-chars-per-token estimate is intended).
