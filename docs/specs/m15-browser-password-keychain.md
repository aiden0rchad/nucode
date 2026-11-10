# M15 — In-app browser password keychain the agent and harness cannot read

## Goal
The native in-app browser (macOS WKWebView, `apps/nucode/src-tauri/src/browser/native/`) gets a small
password manager:
- **Save**: after the user signs in on a page, nucode offers "Save password for <origin> (<username>)?"
  [Save] [Never for this site] [Not now]. Passwords can also be added in Settings → Browser.
- **Fill**: a key button in the browser toolbar fills a saved login for the current origin, only after
  the user passes Touch ID / Mac password (macOS LocalAuthentication).
- **Isolation**: no agent, MCP client, socket client, diagnostics log or UI state can read a saved or
  typed password. Agents are paused on a tab while a filled credential is on it, and can never run page
  scripts, read console or take screenshots on a page whose password field holds a value.

Done = all behavior below, tests, verification passes. Read the whole spec before starting.

## Threat model (what must hold)
1. Passwords are stored only in the macOS Keychain (via the existing `keyring` crate, as provider keys
   are in `src-tauri/src/shared/providers.rs` `Keychain`), service `dev.nucode.browser-passwords`,
   account = entry id (uuid). Items are created by the signed nucode app; other processes (agents' bash,
   Claude Code) cannot read them without a user-approved Keychain prompt.
2. Metadata (`id, origin, username, createdAt, lastUsedAt`) and the never-save list live in
   `<app data>/browser/passwords.json`, written atomically with mode 0600. No passwords in it.
3. **No password action is reachable through `Browser::request`, `NativeBackend::command`, the browser
   control socket (`serve_client`), the MCP proxy (`launcher.rs`), the remote daemon, or any `browser_*`
   tool.** Any same-uid process can talk to that socket, so password operations are separate
   `#[tauri::command]`s only (main webview UI). The global `invoke_handler` guard in `lib.rs` already
   rejects commands from `browser-*` webviews; keep that. Do not register them for the daemon/remote RPC.
4. A password never appears in: the browser `watch` state (and therefore the UI subscription), tool
   results, errors, `eprintln!`, diagnostics (call `nucode_diag_mcp::writer::remember_secret` on every
   password read/captured so accidental logging is redacted), script source that is logged, or
   localStorage. The UI only ever sends a password *to* Rust (Settings add form) and never receives one.
5. Filling requires user presence: LocalAuthentication `LAPolicyDeviceOwnerAuthentication` (value 2)
   with reason "fill your saved password for <host>", unless the user turned the setting off. UI
   automation cannot pass it.
6. Agent isolation on pages (see "Gating").

## Settings
Add to the browser settings struct (`src-tauri/src/types.rs` `BrowserSettings` and the TS type
`BrowserSettings` in `src/types.ts`, plus `defaultBrowserSettings` in `src/features/browser/browser.ts`):
- `offerToSavePasswords: bool` (default true)
- `requireAuthToFill: bool` (default true)
Serde defaults so existing settings files load.

## Rust
### `src-tauri/src/browser/passwords.rs` (new)
- `Index` load/save (atomic write + 0600, like other app-data writers), entries + `never: Vec<origin>`.
- A `Secrets` trait (get/set/delete by id) with the keyring implementation and an in-memory fake for
  tests — mirror `KeyStore`. Read results go through `remember_secret`.
- Pure helpers with unit tests: origin normalization (`scheme://host[:port]`, http/https only, reject
  others), matching (exact origin), "same credential already saved" check, never-list handling.
- `Pending` offer: `{origin, username, password, created}` held in a `Mutex` inside the native backend
  (not in state), expires after 120 s or on decision; at most one.
- LocalAuthentication gate (macOS): link the framework
  (`#[link(name = "LocalAuthentication", kind = "framework")] extern "C" {}`), get `LAContext` with
  `objc2::runtime::AnyClass::get(c"LAContext")`, call
  `evaluatePolicy:localizedReason:reply:` with a `block2::RcBlock` reply, await via a oneshot. No new
  crates. Errors → "Authentication was cancelled" style messages without system detail.

### Private-world page script `src-tauri/src/browser/native/passwords.js` (new)
Installed per tab as a `WKUserScript` in the existing private content world
(`nucode.browser.private`, see `macos.rs` `WORLD`), main frame, document start, via
`WKUserContentController addUserScript:` from `with_webview` during `create_view` (enable the needed
`objc2-web-kit` features — `WKUserScript`, `WKUserContentController` — in `Cargo.toml`; that feature-flag
edit is allowed). It shares the DOM with the page but not its JS globals, so page scripts cannot see or
patch it. It exposes, on a private global only that world can see:
- `sensitive()` → true if any connected `input` that is, or ever was, `type=password` (track with a
  `WeakSet`: scan at DOMContentLoaded, on `input`/`focusin` events (capture), and a `MutationObserver` on
  `type` attribute changes and added nodes), or has `autocomplete` `current-password` / `new-password` /
  `one-time-code`, has a non-empty value. Catches the user typing, and the "show password" eye that flips
  the type to text.
- `isSensitive(el)` used by the snapshot redaction (below).
- Capture: on `submit` (capture phase), and on Enter in / click of a submit control for a form containing
  a non-empty password input, record `{origin: location.origin, username, password}` where username is
  the nearest preceding visible text/email/tel input in the same form, or one with
  `autocomplete=username|email`. Keep only the latest, with a timestamp; `takeCaptured()` returns and
  clears it (only if < 120 s old).
- `fill(username, password)` → finds the first visible password input (and its username field as above),
  sets values with the native value setter and dispatches `input` + `change` (like `bridge.js` `type`),
  remembers the filled elements, returns `{filled: boolean, username: boolean}`. Credentials are passed
  as call arguments (`callAsyncJavaScript:arguments:inFrame:inContentWorld:`), not concatenated into
  source.
JS unit tests (jsdom, next to the existing `nativeBridge.test.ts` / `nativePageHooks.test.mjs` pattern):
capture on submit, username heuristics, `sensitive()` for typed value / type flip / emptied field,
`fill` sets values and fires events.

### Native backend (`src-tauri/src/browser/native/mod.rs`)
- Per-tab flag `credentialsPaused` in tab state (bool is fine to expose). Set after a successful fill;
  cleared on the next main-frame page load start for that tab (`on_page_load` Started) and by the resume
  command.
- **Gating** (in `command`, before dispatch, for whatever tab the action targets):
  - if `credentialsPaused`: reject every agent-facing action — `tool` (all `browser_*` tools routed
    through `backend::tool`), `script` (snapshot/click/type/press/select/fill/scroll/wait), `evaluate`,
    `console`, `dialog`, `screenshot`, `navigate`/`back`/`forward`/`reload` **when the request came from
    a tool call** — with
    "Paused while the user signs in with a saved password. Try again after they finish."
    UI-originated navigation (address bar, back/forward from the pane) stays allowed. Distinguish tool
    calls by the existing `"action":"tool"` path in `Browser::local_request` → `backend::tool` (pass a
    flag down, e.g. route tool calls through a `NativeBackend::tool_request` that applies the stricter
    check); raw socket requests for `script`/`evaluate`/`console`/`dialog`/`screenshot` are always
    treated as agent requests.
  - if not paused, for `evaluate`, `console`, `screenshot` (any source): run `sensitive()` in the private
    world first; if true reject with
    "A password field on this page has a value, so scripts, console and screenshots are blocked until it
    is submitted or cleared."
  - snapshot (`script` op `snapshot` in `bridge.js`): redact `value` for elements where the private
    world's `isSensitive(el)` is true (today only `type=password` is redacted). Implement by having the
    snapshot op consult a marker attribute set by the private world (e.g. the private world sets
    `data-nucode-sensitive` on tracked elements; `bridge.js` already runs in the same private world, so
    prefer calling the shared private global directly if both scripts are in that world).
- Capture pickup: during `poll` (already runs ~4×/s for the active tab), call `takeCaptured()` in the
  private world; if a capture arrives and `offerToSavePasswords` is on, the session is not private
  browsing, the origin is not in `never`, and the same origin+username+password is not already saved:
  store it as `Pending` and set state `passwordOffer: {origin, username, update}` (`update` = an entry
  for origin+username exists with a different password). Never put the password in state.
- Methods called only by the Tauri commands below (not reachable from `command`):
  `fill_saved(tab_id, entry_id)`, `take_offer()`, `resume(tab_id)`, `has_logins(origin)`.
- State per active tab: `savedLogins: [{id, username}]` for the tab's origin (no secrets), refreshed when
  the active tab's origin changes or the index changes, so the toolbar knows whether to show the key.

### Tauri commands (`src-tauri/src/browser_commands.rs`, registered in `lib.rs`)
- `browser_passwords_list()` → `{entries:[{id, origin, username, createdAt, lastUsedAt}], never:[origin]}`
- `browser_password_save({origin, username, password})` (Settings add / replace)
- `browser_password_delete({id})`, `browser_password_unblock({origin})` (remove from never list)
- `browser_password_fill({tabId, id})` → checks the entry's origin equals the tab's current origin,
  runs the LocalAuthentication gate when `requireAuthToFill`, reads the secret, calls `fill_saved`,
  updates `lastUsedAt`, sets `credentialsPaused`. Returns `{filled, username}` only.
- `browser_password_offer({decision: "save" | "never" | "dismiss"})` → acts on the `Pending`, clears
  `passwordOffer`.
- `browser_password_resume({tabId})` → clears `credentialsPaused`.
All return `Result<_, String>` with no secret content in errors. Add a test that none of these names
are accepted by `NativeBackend::command` / `Browser::request` (they must fall through to the existing
"unknown action"/"Try the Headless Chromium backend" errors).

## Frontend
- `src/services/tauri.ts`: wrappers for the commands.
- `src/features/browser/BrowserPane.tsx` (native backend only):
  - Key button in the toolbar (lucide `KeyRound`, aria-label "Fill saved password") shown when the active
    tab's `savedLogins` is non-empty; one login → fills directly; several → small menu of usernames.
    Show errors in the existing error area.
  - `passwordOffer` banner styled like the existing `browser-confirm` alerts: "Save password for
    {origin} as {username}?" (or "Update password…" when `update`) with Save / Never for this site /
    Not now.
  - When the active tab has `credentialsPaused`: a banner "Agent paused on this page while you sign in"
    with a "Resume agent" button.
- `src/features/settings/components/sections/SettingsBrowserSection.tsx`: "Saved passwords" — toggles for
  `offerToSavePasswords` and `requireAuthToFill`; list of entries (origin, username, Delete); an "Add"
  form (origin URL, username, password input `type=password autocomplete="off"`) that calls
  `browser_password_save` and clears the field; "Never saved" list with Remove. **No reveal / copy of
  passwords anywhere.**
- Types for the new state fields in `src/features/browser/browser.ts` `BrowserState`.
- Tests (vitest): banner actions call the right commands; key button visibility; settings add/delete;
  the password input is cleared after save and never rendered back.

## Files
New: `src-tauri/src/browser/passwords.rs`, `src-tauri/src/browser/native/passwords.js` (+ JS test).
Modify: `src-tauri/src/browser/{mod.rs,native/mod.rs,native/macos.rs,native/bridge.js,backend.rs}`,
`src-tauri/src/browser_commands.rs`, `src-tauri/src/lib.rs` (register commands), `src-tauri/src/types.rs`,
`src-tauri/Cargo.toml` (objc2-web-kit feature flags only), `src/types.ts`, `src/services/tauri.ts`,
`src/features/browser/{browser.ts,BrowserPane.tsx,browser.css}`,
`src/features/settings/components/sections/SettingsBrowserSection.tsx`, tests.
Off-limits: `src-tauri/src/computer/`, `src-tauri/src/import/`, onboarding, other specs, new crates.

## Constraints
- Follow surrounding style; terse; no comments that restate code.
- Windows/Linux must still compile: macOS-only pieces behind `#[cfg(target_os = "macos")]`; on other
  platforms the commands return "Saved passwords are available on macOS".
- No new crates (use `keyring`, `objc2`, `block2`, `objc2-web-kit` already present).

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib browser::
```
From `apps/nucode`:
```
npx tsc --noEmit && npx vitest run src/features/browser src/features/settings
```
All must pass. The real Keychain/Touch ID path is verified by the reviewer in the built app.

## Out of scope
- Passkeys/WebAuthn, TOTP, iframe (cross-origin) login forms, importing from Safari/Chrome/1Password,
  sync. The CDP (Headless Chromium) backend.
