# M16 — Keep in-app browser sites signed in across restarts (Keychain-backed session cookies)

## Goal
The native in-app browser uses a persistent WKWebsiteDataStore (`data_store_identifier(STORE)` in
`src-tauri/src/browser/native/mod.rs`), so persistent cookies survive restarts, but **session cookies**
(no expiry — e.g. a site's session cookie, an identity provider's `sid`) live only in memory and are lost on every quit,
rebuild or crash. The user was signed out of sites behind single sign-on after every nucode restart.

Done = after the user signs in to a site in the in-app browser, quitting/relaunching nucode (or a crash)
keeps them signed in; verification passes. Safari behaves this way when it restores a session.

## Behavior
- New browser setting `keepSessions: bool`, default `true` (Rust `BrowserSettings` in `types.rs`, TS
  `BrowserSettings` in `src/types.ts`, `defaultBrowserSettings` in `src/features/browser/browser.ts`), with a
  toggle in `SettingsBrowserSection.tsx`: "Stay signed in after restart — keeps sites' session cookies in
  your macOS Keychain". Serde default so old settings load.
- **Save** (macOS, persistent store only; never when private browsing is on or `keepSessions` is off):
  register a `WKHTTPCookieStoreObserver` on the persistent store's `httpCookieStore`; on
  `cookiesDidChangeInCookieStore:` debounce 3 s, then `getAllCookies`, keep only `isSessionOnly()` cookies,
  serialize each (name, value, domain, path, secure, httpOnly, sameSite policy if available, originURL /
  portList if present) plus `savedAt`, and write the JSON to the Keychain via the `keyring` crate:
  service `dev.nucode.browser-sessions`, account `session-cookies`. Also save once on app exit
  (`ExitRequested` path in `lib.rs`, before teardown) best-effort with a short timeout. Call
  `nucode_diag_mcp::writer::remember_secret` on cookie values? No — values can be numerous; instead make
  sure nothing in this path logs or records cookie names/values anywhere (no `eprintln!`, no diagnostics
  beyond a count-free success/failure code).
- **Restore** at startup, before the first browser view loads: get the store with
  `WKWebsiteDataStore::dataStoreForIdentifier` (macOS 14+, the same identifier as `STORE`; on older macOS the
  backend is already non-persistent → skip), read the Keychain item, drop it if `savedAt` is older than 7
  days, and `setCookie` each cookie (rebuild with `NSHTTPCookie::cookieWithProperties`). `create_view` must
  await the restore once (e.g. a `tokio::sync::OnceCell` / `Notify` set when all completion handlers fired,
  bounded by a 3 s timeout) so the first request already carries the cookies.
- **Clear**: the existing "Delete browsing data" (`clear` action and Settings button) and turning
  `keepSessions` off delete the Keychain item. Private browsing never reads or writes it.
- Threat model: agents/harness must not read session cookies. They stay in WebKit and the Keychain item
  (ACL bound to the signed nucode app); never in the browser `watch` state, tool results, files,
  localStorage or logs. No password/cookie action is reachable through the browser control socket.

## Code
- New `src-tauri/src/browser/native/sessions.rs` (macOS) for observer/save/restore + a pure, unit-tested
  (de)serializer and the age check (`#[cfg(test)]` round-trip with fake cookie property maps).
- Wire into `NativeBackend::new` / `create_view` (restore gate) and `lib.rs` exit hook.
- Enable objc2 feature flags as needed (`objc2-web-kit`: `WKHTTPCookieStore`; `objc2-foundation`:
  `NSHTTPCookie`, `NSDate`, `NSDictionary`, `NSArray`) — feature-flag edits only, no new crates.
- Non-macOS: compile; setting is a no-op.

## Files
`src-tauri/src/browser/native/{sessions.rs (new), mod.rs, macos.rs}`, `src-tauri/src/browser/mod.rs` (clear),
`src-tauri/src/lib.rs` (exit save), `src-tauri/src/types.rs`, `src-tauri/Cargo.toml` (features),
`src/types.ts`, `src/features/browser/browser.ts`,
`src/features/settings/components/sections/SettingsBrowserSection.tsx` (+ its test). Off-limits: other areas.

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib browser:: && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo build --release
```
From `apps/nucode`: `npx tsc --noEmit && npx vitest run src/features/browser src/features/settings`.
The real restart behavior is verified by the reviewer in the built app.

## Out of scope
Restoring open tabs/history after restart, syncing, the CDP backend.
