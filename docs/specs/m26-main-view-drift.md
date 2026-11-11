# M26 — Detect and repair main view drift (macOS)

## Goal

Sometimes, after the app has been running a while, the whole nucode UI on macOS is drawn about
60 pt lower than it should be: an empty band appears across the top next to the traffic
lights and the bottom of the composer is cut off. Restarting fixes it. It has not been
reproduced on demand, and resizing or zooming the window does **not** fix it. The likely
mechanism is that the main WKWebView's frame no longer fills its superview (it is a child
webview because tauri's `unstable` feature is on; `browser/native/mod.rs` resizes it after
`add_child`, and `lib.rs` has a comment about `inner_size()` reporting the webview's own frame).
An inset applied by WebKit itself (`safeAreaInsets`, or on macOS 26 `obscuredContentInsets`)
would also explain it.

Done means: on macOS, whenever the main window resizes, moves between screens, changes scale or
gains focus, nucode checks the main webview against its superview. If the webview's frame
differs from the superview's bounds by more than 1 pt on any edge, nucode sets the frame back to
the superview's bounds. It records **one** diagnostics event (at most one per 60 s) describing
what it saw, so the next occurrence tells us the cause even if the repair hides it.

## Files

- New: `apps/nucode/src-tauri/src/window_layout.rs` (macOS code behind `#[cfg(target_os = "macos")]`,
  the pure helper below compiled on every platform so it can be unit-tested).
- `apps/nucode/src-tauri/src/lib.rs`: `mod window_layout;` and a call from the existing
  `.on_window_event` closure for the `main` window on `WindowEvent::Resized(_)`,
  `WindowEvent::ScaleFactorChanged { .. }` and `WindowEvent::Focused(true)`.
- `apps/nucode/src-tauri/src/browser/native/mod.rs`: in the `*stage = "layout"` block, after the
  existing `set_auto_resize` / `set_size` calls, call the same check once.
- Off-limits: everything else. Do not change the existing `set_size` / `set_auto_resize` logic,
  `window.rs`, `window_material.rs`, the frontend, or any diagnostics allowlist.

## Design

1. Pure helper (unit-tested, all platforms):
   ```rust
   pub(crate) struct Rect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }
   /// None when `frame` fills `bounds` within 1 pt on every edge; otherwise a short
   /// description such as "frame 0,0 1568x698 in bounds 0,0 1568x758 (top -60, bottom 0, left 0, right 0)".
   pub(crate) fn drift(frame: &Rect, bounds: &Rect) -> Option<String>
   ```
   Edges are compared in the superview's coordinate space (AppKit is bottom-left origin unless
   `isFlipped`; compute each edge's difference as `frame_edge - bounds_edge` so the sign is
   consistent and say which convention the message uses in a doc comment).
2. `pub(crate) fn check(webview: &tauri::Webview, reason: &'static str)` (macOS):
   - Use `webview.with_webview(|platform| …)` exactly as `window.rs` does (it already reaches the
     `WKWebView` pointer and runs on the main thread) — no new crates, use the existing `objc2`,
     `objc2-app-kit` crates and `msg_send!`.
   - Read the WKWebView's `frame`, its `superview`'s `bounds` and `isFlipped`, the window's
     `contentView` bounds and `contentLayoutRect`, the WKWebView's `safeAreaInsets`, and, only if
     it `respondsToSelector:` `obscuredContentInsets`, that value.
   - If `drift` returns Some: `setFrame:` the WKWebView to the superview's bounds, then record the
     event (below). If drift is None but the top safe-area or obscured inset is > 1 pt, record the
     event without changing anything (WebKit owns that inset; we only want to learn about it).
   - Throttle: a `static` holding the last record `Instant`; skip recording (not repairing) if
     under 60 s ago.
3. Event: `nucode_diag_mcp::writer::record(|| { let mut e = nucode_diag_mcp::core::event("error",
   "ui", "ui.main_view_drift", "Main view moved inside the window"); … })` — check the exact
   path/signature of `core::event` in `apps/nucode/src-tauri/src/diagnostics/core.rs` and how
   other callers set fields. Put everything in `detail["note"]` as one string (`note` is already
   allowlisted; do not add keys): reason, the drift text, `repaired: yes|no`, content bounds,
   contentLayoutRect, safe-area insets, obscured insets (or "n/a"), and the class names of the
   window `contentView`'s direct subviews in order. Numbers only — no titles, URLs or paths.
4. Never panic: every native read is best-effort; on any failure just return.

## Constraints

- Match the surrounding Rust style (dense, `Result<_, String>` where errors exist, no new
  abstractions beyond the two functions). No new dependencies. If an `objc2-app-kit` feature
  flag is needed for a type, prefer plain `msg_send!` returning `objc2_foundation::NSRect` /
  a `#[repr(C)]` struct for `NSEdgeInsets` rather than adding features.
- The repository is public: no personal names, home paths or hostnames anywhere.
- Commit nothing; leave the changes in the working tree.

## Verification

Run from the worktree root (`TMPDIR` must point inside it):

```
mkdir -p .tmp
( cd apps/nucode/src-tauri && TMPDIR="$PWD/../../../.tmp" cargo test --lib window_layout )
( cd apps/nucode/src-tauri && TMPDIR="$PWD/../../../.tmp" cargo clippy --lib 2>&1 | grep -E "window_layout|^error" ; true )
( cd apps/nucode/src-tauri && TMPDIR="$PWD/../../../.tmp" cargo build )
```

Unit tests for `drift`: exact fit → None; within 1 pt → None; frame shifted down 60 pt with the
same height (bottom clipped) → Some naming the top and bottom edges; frame 60 pt shorter at the
top → Some. The build must succeed with no new warnings in `window_layout.rs`.

If a Swift build script fails with "precompiled file … module cache path", run
`cargo clean -p apple-cf -p apple-metal -p screencapturekit` in `apps/nucode/src-tauri` once and retry.

## Out of scope

- Finding the root cause, changing when browser child views are created, or any frontend change.
- Windows and Linux behaviour (the call sites must still compile there: gate them).
