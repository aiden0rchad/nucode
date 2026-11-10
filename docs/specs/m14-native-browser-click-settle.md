# M14 — Native browser: settle after actions that navigate, quieter click results

## Goal
In the native (WKWebView) in-app browser, an agent's `browser_click` / `browser_type` with `submit` /
`browser_press_key` / `browser_select_option` that starts a page load must not return until that load
finishes, so the agent's next call sees the new page. Observed on a real site (2026-11-09): click
"Assignments" → returned immediately → the next `browser_evaluate` ran on the half-loaded page
(`document.querySelector('main')` was null) and the agent had to spend a turn retrying. Playwright MCP
(the CDP backend) already waits for navigations a click starts.

Also: every click/type result currently carries
`"note":"Synthetic input is not isTrusted. If the site ignored it, Try the Headless Chromium backend (Settings → Browser)"`,
repeated in every result and the agent's context. Say it once in the tool description instead.

Done = both changes with tests, verification passes.

## Code to read first (codegraph_explore)
- `apps/nucode/src-tauri/src/browser/backend.rs` — `BrowserBackend` trait defaults (`click`, `type_text`,
  `press`, `select` send `{"action":"script","op":…}`), `tool()`, `filter_tools()` (rewrites tool
  descriptions for the native backend).
- `apps/nucode/src-tauri/src/browser/native/mod.rs` — `NativeBackend`, its `BrowserBackend` impl
  (`navigate` already waits on `self.state` until the tab is `ready`/errored with a 20 s timeout — reuse
  that pattern), `command()`, `update`/`tab`/`active`, `on_page_load` (sets `loading`/`ready`/`url`),
  `on_navigation`.
- `apps/nucode/src-tauri/src/browser/native/bridge.js` — click/type ops that add the `note`.

## Behavior
1. In `NativeBackend`'s `BrowserBackend` impl, override `click`, `type_text`, `press`, `select` (keep the
   trait defaults for other backends). Each: remember the active tab id and its current `url` + whether it
   is `loading`, run the existing script op via `command`, then **settle**:
   - wait up to 400 ms for a navigation to start on that tab (state shows `loading == true`, or `ready`
     flips to false, or `url` changes) — subscribe to `self.state` like `navigate` does, no polling loop
     with sleeps beyond what `watch` gives you;
   - if one started, wait until the tab is `ready == true` or has an `error`, up to 15 s;
   - return the op's result object with `"navigated": <final url>` added when a navigation happened; on
     the 15 s timeout return the result with `"loading": true` added (not an error — the action did run);
     if the tab disappears, return the result unchanged.
   If no navigation starts within 400 ms, return the result as today (no extra delay beyond the 400 ms).
   Do not hold the `views` mutex while waiting (as `navigate` does: run `command`, then wait).
2. `bridge.js`: drop the `note` field from the click/type results (keep `performed: true` and anything
   else they return). In `backend.rs` `filter_tools`, for the native backend append to the
   `browser_click` and `browser_type` descriptions: "Input is synthetic (not isTrusted). If a site ignores
   it, tell the user; the Headless Chromium backend (Settings → Browser) sends trusted input."
3. Keep everything else unchanged (policy checks, errors, `wait` op, CDP backend).

## Files
- `apps/nucode/src-tauri/src/browser/native/mod.rs` (impl + tests in its `mod tests`)
- `apps/nucode/src-tauri/src/browser/native/bridge.js`
- `apps/nucode/src-tauri/src/browser/backend.rs` (+ its tests)
- any JS test that asserts the old `note` (search `isTrusted` in `apps/nucode/src` tests, e.g.
  `src/features/browser/nativeBridge.test.ts`)

Off-limits: everything outside `src-tauri/src/browser/` and those tests; `docs/specs/` other than this
file; dependency changes.

## Tests
- Settle logic as a pure-ish async helper testable without WebKit: given a `watch::Sender<Value>` state and
  a tab id, (a) no navigation within the grace window → returns quickly without `navigated`;
  (b) state goes loading→ready with a new url → returns `navigated` with that url; (c) loading that never
  finishes → returns `loading: true` after the timeout (use small injected durations in tests);
  (d) tab removed → returns unchanged.
- `filter_tools` native descriptions include the synthetic-input sentence; click results no longer
  contain `note`.

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib browser::
```
From `apps/nucode`:
```
npx vitest run src/features/browser
```
Both must pass.

## Out of scope
- SPA route changes that do not trigger a page load (history.pushState) beyond the 400 ms grace.
- The CDP backend, tab/agent ownership, session persistence.
