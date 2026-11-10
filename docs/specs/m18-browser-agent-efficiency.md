# M18 — Leaner, faster browser tool results and small UX fixes

Found while the omp agent browsed a documentation site in the real app (2026-11-09). Builds on M13–M17 (in tree).

## 1. Compact `browser_snapshot` for agents
Native `browser_snapshot` returns JSON `{nodes:[{ref, role, name, value, bounds:{x,y,w,h}}], truncated}`
from `bridge.js` (op `snapshot`). A docs page produced 41,068 characters: every node carries pixel
bounds, and container elements (`main`, `nav`, `header`, `footer`, `form`, `[role=region]`, banner…) carry
their entire text content as `name`, duplicating the page text many times.

In `src-tauri/src/browser/backend.rs` `tool()`, for `browser_snapshot` results that have a `nodes` array,
return a compact text snapshot instead of the JSON (the UI's own snapshot/annotation paths are untouched —
only the tool result changes):
```
- e1 banner "Skip to content Menu"
- e2 link "Skip to content"
- e10 textbox "Search chapters and articles" value="Syllabus"
[truncated: more elements not shown]
```
Rules: one line per node `- {ref} {role} "{name}"`, append ` value="…"` only when value is a non-empty
string; collapse whitespace; cap names at 80 chars for container/landmark roles (banner, navigation, main,
contentinfo, form, region, complementary, generic with children…) and 160 chars otherwise (add `…`); drop
nodes whose name is empty AND role is `generic`; escape `"` in names/values; no bounds. Keep `truncated`
as the trailing line and keep `dialogNote` (macOS) as a trailing `Dialog: …` line. Values of sensitive
fields are already omitted upstream — keep it that way. Update the native tool description of
`browser_snapshot` in `filter_tools` to mention "refs (e.g. e12) work with browser_click/type".
Tests: conversion of a representative node list (incl. long container names, empty generic, quotes,
truncated flag, dialogNote) and that the CDP path (no `nodes`) is untouched.

## 2. Back/forward wait for the page
`browser_navigate_back` returned `{"canGoBack":true,"canGoForward":false,"progress":0.1}` before the page
loaded. Route native back/forward (tool and any agent path) through the M14 `settle_action` helper like
click/press, and return the trimmed tab (item 3) when a navigation happened.

## 3. Trim tab objects in tool results
After M17 strips images, tab objects in `browser_navigate` / `browser_tabs` / back results still carry
internal fields (`credentialsPaused`, `savedLogins`, `progress`, `snapshot:null`, `error:null`, …). In
`backend::tool`, reduce every tab object in those results to `id, url, title, ready, loading, canGoBack,
canGoForward` plus `error` only when non-null and `credentialsPaused` only when true. UI state unchanged.
Test with a full native tab object.

## 4. Address bar selects its text on focus
`src/features/browser/BrowserPane.tsx`: clicking/focusing the URL input should select the whole URL
(like Safari/Chrome) so typing replaces it; a second click places the caret normally. Test in
`BrowserPane.test.tsx`.

## 5. Show the browser when the agent starts using it
When the agent uses the in-app browser, the panel often stays closed, so the user can't watch.
`BrowserState.agent` flips true while a tool call runs (see the `activity` action in
`launcher.rs`/`native/mod.rs` and the "Agent is using the browser" banner in `BrowserPane.tsx`). In
`src/features/app/hooks/useSidePanelState.ts` (the hook that subscribes to browser state for the current
`code:` scope), when `agent` goes false→true and the panel is closed or the browser tab isn't the active
panel tab, open the panel on the browser tab that targets the native active page (create the panel tab if
needed, as the existing new-page path does) — at most once per agent turn, and never if the user closed
the browser panel after it was auto-opened in this turn (remember that in a ref; reset when `agent` stays
false for 5 s). Don't move keyboard focus. Tests with a mocked subscription.

## Files
`src-tauri/src/browser/{backend.rs,native/mod.rs}`, `src/features/browser/{BrowserPane.tsx,BrowserPane.test.tsx}`,
`src/features/app/hooks/useSidePanelState.ts` (+ the side panel tests). Off-limits: everything else.

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib browser::
```
From `apps/nucode`: `npx tsc --noEmit && npx vitest run src/features/browser src/features/panels src/features/app`.
All must pass.
