# M17 — Native browser robustness: no URL panic, lean tool results, iframe policy, ready pages

Found while the omp agent browsed a real site in the real app (2026-11-09). Builds on M13–M15 (already in the
tree). Read the code with codegraph before editing.

## 1. Crash: `view.url()` panics on a page with no URL yet (critical)
nucode quit twice (no crash report). stderr:
`thread 'main' panicked at …/wry-0.54.2/src/wkwebview/mod.rs:1304:40: called Option::unwrap() on a None value`
— wry's `url_from_webview` does `webview.URL().unwrap()`. A WKWebView has no URL until its first load
commits (a just-created or just-recreated tab). `NativeBackend::command` calls tauri's `view.url()` before
`screenshot`/`evaluate` target checks, in the `script|evaluate|console|dialog` branch, in `screenshot`
(twice) and `clearSite`; an agent `browser_evaluate`/`browser_snapshot` on a recreated tab hit it and the
main-thread panic ended the app.

**Already fixed on `main`** (commit "Never read a browser page URL through wry's panicking getter"):
`macos::page_url` + `native::current_url` replace every `view.url()`. Keep it that way: any new code
(including M15's password/gating code) must use `current_url(&view)` and never tauri's `Webview::url()`
on browser views. Add a grep-style unit test or a short comment at `current_url` if helpful.

## 2. Wait for a recreated page before agent calls
Tabs whose view was dropped (live-view limit, panel closed) are recreated on demand and load again; an
agent call landing right then fails or (before fix 1) crashed. For agent-facing reads — `browser_snapshot`,
`browser_evaluate`, `browser_take_screenshot`, `browser_console_messages`, and the script ops
click/type/press/select/scroll/fill — if the active tab is not `ready` (and has no `error`), wait up to
15 s for it to become ready before running the op, **without holding the `views` mutex while waiting**
(same pattern as `NativeBackend::navigate` / M14's `settle_action`: trigger the view via a cheap command,
then wait on `self.state`). On timeout return "The page is still loading; try again in a moment".
Tests with a fake `watch` state like M14's settle tests.

## 3. Tool results must not carry the tab thumbnail
`hide()` stores a base64 PNG `snapshot` on the tab in `self.state` (the pane uses it as a placeholder).
`browser_navigate` returns that tab object and `browser_tabs` (`list`) returns all tabs, so each call put
~41 KB of base64 into the agent's context (seen in real sessions: navigate/tabs results of 41,072 chars).
Fix in `src-tauri/src/browser/backend.rs` `tool()` (native and CDP paths alike): strip `snapshot` (and any
other `data:`-URI or base64 image fields, e.g. a `favicon` that starts with `data:`) from every tab object
in tool results, recursively for arrays. The UI state is unchanged. Test: navigate/tabs results without
`snapshot`; other fields preserved.

## 4. Subframe navigations must not fail the whole tab
On community.canvaslms.com a Cloudflare challenge iframe navigated to a URL the top-level policy blocks
(`about:srcdoc`, a cross-origin `blob:` or a `data:` document), and `on_navigation` set the **tab** error
"Navigation blocked by browser policy", replacing the whole page with the Retry overlay. Tauri's
`on_navigation` callback gets no frame info.

Fix in `src-tauri/src/browser/native/navigation_events.rs` (the existing WKNavigationDelegate proxy that
forwards to wry's delegate): implement `webView:decidePolicyForNavigationAction:decisionHandler:`.
- If `navigationAction.targetFrame` is `Some` and `!isMainFrame()` (a subframe): decide locally and call
  the decision handler directly — allow `http`, `https`, `about:` (any), `data:`, `blob:`; cancel
  everything else (`file`, `javascript`, `tauri`, `asset`, `ipc`, app schemes, unknown/external schemes)
  **without** touching tab state.
- Otherwise (main frame, or `targetFrame` nil = new window): forward to the original delegate exactly as
  today (wry → tauri `on_navigation` → nucode policy).
Keep `respondsToSelector:`/forwarding behavior for every other selector. Put the subframe scheme decision
in a pure fn in `policy.rs` with unit tests. Enable any objc2-web-kit features needed (`WKNavigationAction`,
`WKFrameInfo` is already on) — feature-flag edits in `Cargo.toml` are allowed, no new crates.

## 5. Password protection must not break pages that missed the private script
M15's `macos::sensitive()` / `password_call` call `globalThis.__nuPasswords` in the private world; on a
document created before `install_passwords` added the WKUserScript (a tab's first load racing the
install), the global is missing, the call errors, and agent `browser_evaluate`/console/screenshot are
blocked with "Password operation unavailable". `passwords.js` is idempotent (`if (globalThis.__nuPasswords) return;`),
so make `password_call` prepend `include_str!("passwords.js")` to every source it runs (installing on
demand), keeping fail-closed behavior if the call still errors. Test that the composed source starts with
the script and that a second injection is a no-op (JS test in `nativePasswords.test.mjs`).

## 6. `browser_tabs` `new` ignores its `url`
`backend::tool` sends `{"action":"tabs","params":args}`; `NativeBackend::command` maps `params.action ==
"new"` to `action = "new"` but then reads `p["url"]` (top level), so `browser_tabs {"action":"new","url":…}`
opens `about:blank`; the agent's next evaluate kept failing with "still loading" until it navigated
manually (seen in a real run). Read the URL from `p["params"]["url"]` when the action came from `tabs`
(fall back to `p["url"]`), apply the same navigation policy, and make `new` with a URL wait for that page
like `navigate` does (return the tab without thumbnails, per item 3). Test via the command/tool path.

## Files
`src-tauri/src/browser/{backend.rs,policy.rs,native/mod.rs,native/macos.rs,native/navigation_events.rs}`,
`src-tauri/Cargo.toml` (features only), tests. Off-limits: everything else; other specs.

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib browser:: && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo build --release
```
From `apps/nucode`: `npx vitest run src/features/browser`. All must pass.

## Out of scope
Session persistence (M16), the password keychain (M15), UI changes.
