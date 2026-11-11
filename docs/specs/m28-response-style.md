# M28 — Response style setting (Concise / Standard / In depth)

## Goal

Users report that agent runs stop early and replies are short "like it's not even trying".
Cause: pi's built-in system prompt ends its rules with `- Be concise in your responses` and says
nothing about finishing the work, and nucode never changes that prompt.

Add one app setting, **Response style**, with three values:

| value      | label    | effect on the engine's system prompt                                   |
|------------|----------|-------------------------------------------------------------------------|
| `concise`  | Concise  | today's behaviour; makes sure a "be concise" rule is present           |
| `standard` | Standard | **default** — drops the "be concise" rule, adds the Standard section   |
| `detailed` | In depth | drops the "be concise" rule, adds the In depth section                 |

Done means: the setting is stored in app settings, shown in Settings → Composer as a select,
reaches pi and omp processes, and the gate extension rewrites the system prompt on every agent
start accordingly. Changing it restarts idle engine processes the same way an auto-compact change
does, so it applies from the next turn.

## Design (settled — don't redesign)

### 1. Pure prompt rewrite — `apps/nucode/engines/pi/extensions/lib/responseStyle.ts` (new)

No pi imports; unit-tested with `node --test`.

```ts
export type ResponseStyle = "concise" | "standard" | "detailed";
/** Anything that is not a known style is "standard". */
export function parseResponseStyle(value: string | undefined): ResponseStyle
/** Returns the prompt to use, in the same shape it was given (string for pi, string[] for omp). */
export function applyResponseStyle<T extends string | string[]>(prompt: T, style: ResponseStyle): T
```

Rules:

- The "concise rule" is any whole line matching `/^- Be concise in your responses\.?[ \t]*\r?\n?/m`.
- `standard` / `detailed`: remove the concise rule wherever it appears (in the string, or in every
  array element), then add the section below. For a string, append `"\n\n" + section` (trim the
  prompt's trailing whitespace first). For an array, push the section as a new last element; do not
  mutate the input array.
- `concise`: if the prompt (string, or any array element) already contains the concise rule, return
  the prompt unchanged (same reference is fine). Otherwise add the Concise section the same way.
- Applying a style twice must not add the section twice: if the prompt already contains the
  section's heading line `# How to work and report`, replace from that heading to the end of that
  string/element with the new section instead of appending (for an array, replace the element that
  starts with the heading).

Sections (use these texts exactly):

Concise:
```
# How to work and report

- Be concise in your responses.
```

Standard:
```
# How to work and report

- Keep working until the request is fully handled. When a step fails or a result looks incomplete, try the next reasonable approach yourself instead of stopping to report it. Stop only when the work is done or you need a decision or information that only the user can give.
- Before you finish, check your work against what was asked: run it, test it or re-read it.
- Make the final reply as long as the work needs. Say what you did, what you found and anything the user should check or decide. Do not pad it and do not cut it short.
```

In depth:
```
# How to work and report

- Be thorough. Investigate before you conclude: read the relevant code or sources, consider more than one explanation or approach, and follow up on anything that looks off.
- Keep working until the request is fully handled. When a step fails or a result looks incomplete, try the next reasonable approach yourself instead of stopping to report it. Stop only when the work is done or you need a decision or information that only the user can give.
- Verify results before you report them, and say how you verified them.
- Write a complete final reply: what you did and why, what you found with the evidence, the trade-offs you weighed, and what is still open or risky. Prefer a full explanation to a short one.
```

### 2. Wire it in `apps/nucode/engines/pi/extensions/nucode-gate.ts`

In the existing `before_agent_start` handler: read `parseResponseStyle(process.env.NUCODE_RESPONSE_STYLE)`,
compute `next = applyResponseStyle(event.systemPrompt, style)`, capture `next` (not the original) for
the context report exactly as today, and `return { systemPrompt: next }` when `next !== event.systemPrompt`
(return nothing otherwise). Wrap the rewrite in try/catch: on any error keep today's behaviour
(capture the original, return nothing). pi's result type takes `systemPrompt: string`, omp's takes
`string[]`; the function keeps the shape, so one code path serves both.

The file is embedded with `include_str!` — add `lib/responseStyle.ts` wherever
`lib/contextReport.ts` is embedded/written (`src-tauri/src/shared/pi/config.rs`, and any omp copy in
`profile.rs`), or the extension will fail to load in the built app.

### 3. Rust: setting, transport, restart

- `apps/nucode/src-tauri/src/types.rs`: `pub(crate) enum ResponseStyle { Concise, Standard, Detailed }`
  with serde `rename_all = "lowercase"`, `Default` = `Standard`, plus
  `fn as_str(&self) -> &'static str`. Add to `AppSettings` right after `auto_compact`:
  `#[serde(default, rename = "responseStyle")] pub(crate) response_style: ResponseStyle,` and to the
  `Default` impl. An old settings file without the key must load as `Standard` (test it).
- `apps/nucode/src-tauri/src/shared/pi/profile.rs` `prepare(...)`: next to `NUCODE_AUTOCOMPACT`, insert
  `NUCODE_RESPONSE_STYLE` = `response_style.as_str()`. Pass the value in the same way
  `auto_compact` is passed (extend the signature; update the callers in `shared/pi/mod.rs` and tests).
- `apps/nucode/src-tauri/src/shared/pi/mod.rs`: add `&settings.response_style` to the spawn
  fingerprint tuple (the `serde_json::to_string(&(registry, policy, &connectors, settings.features(), &settings.auto_compact))`
  line) so a change restarts idle processes exactly like auto-compact does.
- Chat and Work modes go through the same `prepare`, so they get the variable too. That is intended.

### 4. Frontend

- `apps/nucode/src/types.ts` `AppSettings`: `responseStyle?: "concise" | "standard" | "detailed";`
  (absent means standard). Add it to any settings default/fixture object typecheck requires.
- `apps/nucode/src/features/settings/components/sections/SettingsComposerSection.tsx`: add a row
  **Response style** using the same primitives the section already uses (`SettingsRow` +
  `SettingsSelect`, mirroring the existing select at ~line 67), options `Concise`, `Standard`,
  `In depth` (values as above), help text:
  `How much agents explain and how far they carry a task before stopping. Applies from the next turn.`
  Saving goes through the same app-settings update callback the section's other controls use.
  If the section does not receive `appSettings`/the update callback for app-level values, follow how
  another app-level control in that section gets them; do not invent a new save path.

## Files

- New: `apps/nucode/engines/pi/extensions/lib/responseStyle.ts`,
  `apps/nucode/engines/pi/tests/responseStyle.test.ts`.
- Modify: `engines/pi/extensions/nucode-gate.ts`, `src-tauri/src/types.rs`,
  `src-tauri/src/shared/pi/{profile,config,mod}.rs` and the Rust tests beside them
  (`shared/pi/tests.rs`), `src/types.ts`, `SettingsComposerSection.tsx` (+ a test file
  `SettingsComposerSection.test.tsx` beside it if none exists; otherwise extend the existing one),
  and whatever passes props into that section if a prop must be added.
- Off-limits: `.github/`, `window_layout.rs`, checkpoints, codex and ACP engines, generated
  `packages/protocol`, `docs/` other than this spec.

## Constraints

- Match surrounding style (dense Rust, `Result<_, String>`; existing settings primitives). No new
  dependencies.
- Public repository: no personal names, home paths, hostnames or real provider names in code or
  tests.
- Commit nothing; leave the changes in the working tree.

## Verification

From the worktree root (`TMPDIR` inside it):

```
mkdir -p .tmp
( cd apps/nucode/engines/pi && npm test )
( cd apps/nucode/src-tauri && TMPDIR="$PWD/../../../.tmp" cargo test --lib -- shared::pi types settings multiwebview )
( cd apps/nucode && npm run typecheck && npx vitest run src/features/settings src/features/app src/dev )
```

Required new tests:

- `responseStyle.test.ts`: standard/detailed remove the concise rule from a string prompt and append
  the right section; an array prompt gets a new last element and the input array is not mutated;
  concise leaves a prompt that already has the rule unchanged and adds the Concise section when it
  has none; applying a style twice (and switching style on an already rewritten prompt) leaves
  exactly one `# How to work and report` section; `parseResponseStyle` maps unknown/undefined to
  `standard`.
- Rust: settings JSON without `responseStyle` deserializes to `Standard` and serializes
  `"responseStyle":"standard"`; `prepare` sets `NUCODE_RESPONSE_STYLE`; the embedded extension file
  list includes `lib/responseStyle.ts` (extend whichever test already checks the embedded files, if
  one does).
- Frontend: the Composer section shows the select with the saved value (default Standard) and
  choosing "In depth" calls the update with `responseStyle: "detailed"`.

Known sandbox-only failures (tests that bind localhost or run `/bin/ps`): report, don't fix. If a
Swift build script fails with "precompiled file … module cache path", run
`cargo clean -p apple-cf -p apple-metal -p screencapturekit` in `apps/nucode/src-tauri` once and retry.

## Out of scope

- Codex and ACP engines (they own their prompts); a per-thread or per-project override; a slash
  command; changing reasoning effort or token limits.
