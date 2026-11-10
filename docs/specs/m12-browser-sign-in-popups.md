# M12 — In-app browser: target=_blank links and sign-in popups

## Goal

In nucode's native in-app browser (macOS WKWebView child webviews, `src-tauri/src/browser/native/`):

1. Clicking a link with `target="_blank"` (e.g. Gmail's "Sign in" at https://workspace.google.com/gmail/,
   which is `<a href="https://accounts.google.com/…" target="_blank" rel="noopener">`) opens the URL in a
   **new in-app browser tab**. Today nothing happens at all.
2. A script popup (`window.open(url, name, "width=480,height=600")`, as used by "Sign in with Google",
   Firebase `signInWithPopup`, MSAL, Apple sign-in) opens as a **real popup window** that keeps
   `window.opener`, so the popup can `postMessage` back and the opener gets a non-null window from
   `window.open`. When the popup calls `window.close()` (or the opener calls `popup.close()`), the popup
   window closes. Today such popups become a plain tab with `window.opener === null`, and `window.open`
   returns `null`, so sign-in never completes.

Done = both behaviors work in the built app and the verification command passes.

## Root causes (already diagnosed — do not re-investigate)

- **target=_blank does nothing:** `tauri-plugin-opener` (initialized with defaults in
  `src-tauri/src/lib.rs`, `.plugin(tauri_plugin_opener::init())`) has `open_js_links_on_click: true`,
  which injects `init-iife.js` into **every** webview, including browser tabs. On any click of an
  `<a target="_blank">` (or Ctrl/Shift-click of any link) with an http/https/mailto/tel href it calls
  `preventDefault()` and invokes `plugin:opener|open_url`, which is denied in browser tabs. So WebKit
  never sees the navigation. Tauri always prepends plugin init scripts, so browser tabs cannot opt out
  per webview. nucode's own UI never relies on this handler: every external link in the app UI already
  calls `openUrl` itself with `preventDefault` (`Markdown.tsx`, `ReleaseNotes.tsx`, git panels, About).
- **Popups lose the opener:** `on_new_window` in `src-tauri/src/browser/native/mod.rs` always returns
  `NewWindowResponse::Deny` and stores the URL in state `newWindow`; the next `poll` command opens it as a
  separate tab (a new, unrelated page load).

## Files

Modify:
- `apps/nucode/src-tauri/src/lib.rs` — opener plugin init.
- `apps/nucode/src-tauri/src/browser/native/mod.rs` — `on_new_window` in `create_view`; closing popups
  on reset/clear/private-mode change.
- `apps/nucode/src-tauri/src/browser/policy.rs` — a small pure decision helper + unit tests.
- The window-state plugin builder in `lib.rs` (see below).

Create:
- `apps/nucode/src-tauri/src/browser/native/popup.rs` (macOS only, `#[cfg(target_os = "macos")]`,
  declared in `native/mod.rs` next to `mod navigation_events;`) — the `webViewDidClose:` handler.

Off-limits: anything under `src/` (frontend), `src-tauri/src/computer/`, `src-tauri/src/import/`,
`docs/specs/` other than this file, `Cargo.toml` dependency changes.

## Behavior and implementation

### 1. Stop the opener plugin from hijacking link clicks
In `lib.rs` replace `.plugin(tauri_plugin_opener::init())` with
`.plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())` and a one-line
comment why (it injects a click handler into browser tabs and swallows target=_blank links).
After this, a target=_blank click reaches WebKit, which calls `on_new_window` with no size/position,
and the existing `newWindow` → new tab path opens it. Keep that tab path as is.

### 2. Popup vs tab decision (pure helper in `policy.rs`)
Add `pub fn opens_popup(url: &str, has_size: bool, has_position: bool) -> bool`:
`true` when `has_size || has_position || url == "about:blank"`, otherwise `false` (mirrors Chrome:
`window.open` with size/position features is a popup window; a plain link or feature-less
`window.open(url)` is a tab; `window.open("")`/`about:blank` needs the returned window, so popup).
Unit tests: plain link URL → false; size → true; position → true; about:blank → true.

### 3. `on_new_window` in `create_view`
Keep the current policy checks (`navigation(url, url)` and, for http/https, `allowed_origin(url, &settings)`
— clone what you need into the closure). Then:
- `Navigation::Allow` and `opens_popup(...)` → build a popup window (below) and return
  `NewWindowResponse::Create { window }`. If building fails, record
  `nucode_diag_mcp::writer::metadata("error", "browser", "browser.native.popup_failed", json!({}))`
  (no URL in diagnostics) and fall back to the existing tab path (`newWindow`) + `Deny`.
- `Navigation::Allow` otherwise → existing behavior (`newWindow`, `Deny`).
- `Navigation::External` / `Block` → existing behavior.

Popup window (`tauri::WebviewWindowBuilder`), built synchronously inside the callback exactly like the
Tauri 2.10 doc example for `on_new_window` (the callback runs on the main thread; that is supported):
- label `format!("browser-popup-{}", uuid::Uuid::new_v4().simple())` — the `browser-` prefix makes the
  existing `invoke_handler` guard in `lib.rs` reject app commands from it; capabilities only cover
  `main`/`about`, so it gets no permissions. Keep it that way.
- URL `WebviewUrl::External("about:blank")` — WebKit loads the requested URL into the returned view
  itself. Do not load `url` yourself.
- Defaults first, then `.window_features(features)` so page-supplied size/position override them:
  `.inner_size(500., 640.)`, `.center()` only when `features.position()` is `None`, `.resizable(true)`,
  `.title(host of url, or "Sign in")`, `.user_agent(UA)`, `.devtools(cfg!(debug_assertions))`,
  `.focused(true)`, and `.parent(&main_window)` when the `main` window exists (keeps it above nucode).
- **Do not** call `.incognito(..)`, `.data_store_identifier(..)` or `.data_directory(..)` on the popup:
  on macOS `window_features` installs the opener's `WKWebViewConfiguration` (same cookies/data store,
  private mode included); changing the store would mutate the opener's shared configuration.
- `.on_document_title_changed(|window, title| { let _ = window.set_title(&title); })`
- `.on_navigation(...)`: same rule as the tab's `on_navigation` but without updating any tab:
  `Navigation::Allow` and `allowed_origin` → `true`; `Navigation::External` → set state
  `externalRequest` (same as tabs, so the pane asks to open it externally) and `false`; else `false`.
- `.on_new_window(...)` (a popup opening another window): no nested popups — apply the existing tab
  path (`newWindow` for Allow, `externalRequest` for External) and return `Deny`.
- After `build()`, on macOS call `popup::install(&window)` (section 4).

### 4. Close the popup when the page closes it (`native/popup.rs`, macOS)
Wry 0.54.2's `WryWebViewUIDelegate` does not implement `webViewDidClose:`, so `window.close()` in a
script-opened popup currently does nothing. Add a WKUIDelegate proxy, following the existing pattern in
`native/navigation_events.rs` (define_class with ivars holding the original
`Retained<ProtocolObject<dyn WKUIDelegate>>`, `respondsToSelector:` = own || original's,
`forwardingTargetForSelector:` → original, retained in a `thread_local!` map keyed by window label):
- `install(window: &tauri::WebviewWindow)`: `window.with_webview(|platform| …)`, read
  `wk.UIDelegate()`, wrap it, `wk.setUIDelegate(Some(proxy))`, store the proxy. Hold the
  `tauri::WebviewWindow` (or an `AppHandle` + label) in the ivars.
- `#[unsafe(method(webViewDidClose:))]` → close that popup window (`window.close()`; use `destroy()` if
  `close()` is vetoed). Must not panic.
- Remove the map entry when the window is destroyed (`window.on_window_event` →
  `WindowEvent::Destroyed`).
- Everything else (including `createWebViewWithConfiguration…`, JS alert/confirm panels) forwards to
  wry's delegate unchanged.
Add `objc2-web-kit` features only if they are already enabled in `Cargo.toml` (check: `WKUIDelegate`
must be available; if a needed feature is missing, add only that feature flag to the existing
`objc2-web-kit` dependency — that one Cargo.toml edit is allowed).

### 5. Housekeeping
- Window-state plugin (`tauri_plugin_window_state::Builder` in `lib.rs`): add
  `.with_filter(|label| !label.starts_with("browser-"))` so popups are never saved/restored.
- In `NativeBackend::command`, wherever all tab views are closed — the private-browsing switch, the
  `reset` action and the `clear` action — also close every webview window whose label starts with
  `browser-popup-` (`self.app.webview_windows()`), via a small helper.
- `on_window_event` in `lib.rs` already returns early for non-`main` labels; leave it.

## Constraints
- Rust 2021, follow the file's terse style; no comments restating code; keep the existing policy
  functions as the single source of truth for what may load.
- No new crates. No frontend changes.
- Non-macOS builds must still compile: `popup.rs` and its call are `#[cfg(target_os = "macos")]`;
  `WebviewWindowBuilder::window_features` exists on all desktop targets.
- Never put URLs or page content into diagnostics.

## Verification
Run from `apps/nucode/src-tauri`:

```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib browser:: && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo clippy --lib -- -D warnings
```

Both must pass (if clippy reports pre-existing warnings in files you did not touch, report them
instead of fixing them). The UI behavior is verified by the reviewer in the built app.

## Out of scope
- Showing popups to the agent's browser tools, popup tabs in the pane, the CDP (Chromium) backend.
- Other Tauri plugin init scripts in browser tabs (dialog/notification) — page_hooks already handles them.
- Changing the existing `newWindow` → tab mechanism or the pane UI.
