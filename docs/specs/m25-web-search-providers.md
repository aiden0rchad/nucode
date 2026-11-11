# M25 — Web search providers (SearXNG first)

## Goal

M24 added `web_search` backed by scraping DuckDuckGo's HTML page, which answers with a bot
challenge. Replace that with a user-chosen search provider. The setting is shaped so more
providers (Tavily, Brave Search API, …) can be added later as one enum variant plus one function
each; this milestone implements exactly one: **SearXNG** (a self-hosted metasearch instance with
a JSON API, no key).

Done means: Settings → Browser has a "Web search" group with a provider select (Off / SearXNG)
and an instance URL field; with SearXNG configured, `web_search` returns results from
`<instance>/search?q=…&format=json`; with the provider Off, `web_search` is not listed to agents
at all (`web_fetch` still is) and no description mentions it; all DuckDuckGo code is gone.

## Design (settled)

1. **Settings.** `BrowserSettings` (`apps/nucode/src-tauri/src/types.rs`, mirrored in
   `apps/nucode/src/types.ts`) gains one field, serialized like its neighbours:

   ```
   web_search: WebSearchSettings { provider: WebSearchProvider, url: String }
   enum WebSearchProvider { Off (default), Searxng }     // serialized "off" | "searxng"
   ```

   Missing in existing settings files → default (Off, empty url); follow how the struct already
   tolerates missing fields. `browser::validate`: when provider is Searxng, `url` must parse as
   an http(s) URL with a host; error `Enter the SearXNG instance URL (http or https)`.
   Future key-based providers will keep their key in the OS keychain, not in this struct — do
   not add a key field now.
2. **Search.** In `browser/web.rs`, delete `SEARCH_ENDPOINT`, `parse_results`, the challenge
   detection and their tests. `search` dispatches on the provider (a `match`, no trait):
   - `Off` → error `Web search is not set up. Choose a provider in Settings → Browser.`
   - `Searxng` → GET `<url with trailing slashes trimmed>/search` with query `q=<query>` and
     `format=json`, header `Accept: application/json`, 15 s timeout, body through the existing
     capped reader. Follow no redirects (the shared client already disables them); a 3xx is an
     error naming the status. This request goes to the user's own configured instance, so the
     allowed/blocked origin lists do not apply to it.
     Parse `results[]` taking `title`, `url`, `content` (strings; skip entries without an
     http(s) `url`; missing `content` → empty). If the top-level `answers` array has string
     entries (or objects with a string `answer`), put them first as `Answer: <text>` lines.
     Output format is unchanged from M24 (numbered title / url / snippet; `count` default 8,
     max 20).
     Errors (all as `Web search failed: …`): 403 → `the SearXNG instance refused JSON output;
     enable "json" under search.formats in its settings.yml`; other non-200 → the status;
     invalid JSON → `the instance did not return JSON`; zero results → return the text
     `No results.` (not an error).
   Keep a pure `searxng_results(json: &Value, count) -> String` for tests.
3. **Listing.** `backend::filter_tools` (or its caller in `launcher.rs`) lists `web_search` only
   when the provider is not Off. `web_fetch` is always listed. The sentence appended to
   `browser_navigate` and the native note that say "use web_search" must only mention tools that
   are listed: with search Off they say to use `web_fetch` to read a public page and drop the
   web_search wording. A `tools/call` for `web_search` while Off returns the Off error above.
   Chat mode with Web on passes tool names to pi via `--tools` and an allowlist
   (`shared/pi/mod.rs`); keep `web_search` there unconditionally unless pi fails or warns on an
   unknown tool name — check, and if it does, include it only when a provider is configured.
4. **UI.** `apps/nucode/src/features/settings/components/sections/SettingsBrowserSection.tsx`:
   add a "Web search" group, using the same row/select/input components and save path the
   existing fields in that section use (e.g. the search URL field). Provider select with options
   "Off" and "SearXNG"; when SearXNG is selected show an "Instance URL" text field (placeholder
   `https://searx.example.org`). Help text, one line: `Lets agents search in the background
   without opening the browser.` No test button.

## Files

- `apps/nucode/src-tauri/src/types.rs`, `apps/nucode/src/types.ts`
- `apps/nucode/src-tauri/src/browser/web.rs`, `backend.rs`, `launcher.rs`, `mod.rs`
- `apps/nucode/src/features/settings/components/sections/SettingsBrowserSection.tsx` (+ its
  test if one exists; any settings default/fixture objects that must list the new field for
  typecheck)
- Tests beside each change. Anything else only if typecheck or tests require it.

## Constraints

- Same style rules as M24: dense Rust, `Result<_, String>`, no traits/registries for providers,
  no new crates.
- Tests use inline JSON fixtures; no network, no bound ports.
- No real instance URLs, personal names or home paths anywhere in code, tests or docs; use
  `https://searx.example.org`.
- Don't touch `web_fetch` behaviour.

## Verification

```
mkdir -p .tmp
( cd apps/nucode/src-tauri && TMPDIR="$PWD/../../../.tmp" cargo test --lib -- browser:: shared::pi shared::acp shared::connectors types storage settings )
( cd apps/nucode/engines/pi && npm test )
( cd apps/nucode && npm run typecheck && npx vitest run src/features/settings src/features/messages src/features/app )
```

Known sandbox-only failures (tests that bind localhost or call `/bin/ps`): report, don't fix.

## Out of scope

- Tavily, Brave or any other provider; API-key storage; a "test connection" button.
- Committing: leave changes uncommitted.
