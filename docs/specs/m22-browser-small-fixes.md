# M22 — Native browser small fixes from a real-site evaluation

## 1. `browser_select_option` accepts the option label
`src-tauri/src/browser/native/bridge.js` `select(el, values)` matches only `option.value`. An agent passed
the visible label ("STAT-101 Intro Statistics", value "stat1") and got "Unknown option or option is
disabled". Playwright's selectOption accepts value or label. Match each requested string against
`o.value`, then `o.label`, then `o.textContent.trim()` (first match wins, skip disabled options/optgroups),
and select the matched options. Keep the error for no match. Test in `src/features/browser/nativeBridge.test.ts`.

## 2. Reset the tab favicon when a new page starts loading
A local page kept `favicon: "https://sso.example.edu/favicon.ico"` from the previous site. In
`src-tauri/src/browser/native/mod.rs`, when a main-frame page load starts (`on_page_load` `Started`), clear
the tab's `favicon` (and `title` only if the URL's origin changed) so the meta poll fills the new values.
Test the state update helper if one exists, otherwise add a small pure helper with a unit test.

## 3. Tell the agent when its action opened a popup window
Since M12, `window.open` popups with size/position open as separate `browser-popup-*` windows the agent
cannot see or control (they are not tabs). An agent click that opens one gets only `{"performed":true}`.
Record each created popup in the native state (e.g. `state.lastPopup = {url, openedAt}` — URL only, no page
content) in the `on_new_window` Create path, and in M14's `settle_action` (used by click/type/press/select)
add `"popup": {"url": …, "note": "Opened in a separate sign-in window that browser tools can't control; ask
the user to finish it there."}` to the result when a popup was created during the action. Also mention in
the native `browser_click` description: "If a click opens a popup window, the result says so." Tests with a
fake state.

## Files
`src-tauri/src/browser/{native/bridge.js,native/mod.rs,backend.rs}`, `src/features/browser/nativeBridge.test.ts`,
Rust tests. Off-limits: everything else.

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib browser::
```
From `apps/nucode`: `npx vitest run src/features/browser`.
