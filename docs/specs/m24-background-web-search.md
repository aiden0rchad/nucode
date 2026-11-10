# M24 — Background web search and fetch

## Goal

Today the only way an agent can reach the web is the in-app browser (`browser_navigate` and
friends), so every lookup opens the browser panel and walks pages visibly. Add two tools,
`web_search` and `web_fetch`, that run in the background over plain HTTP: no browser process, no
browser panel, no "agent is using the browser" state. Tool descriptions steer models to use them
for looking things up and reading public pages, and to use `browser_*` only when the user asks
for the browser or the page needs sign-in, interaction or JavaScript.

Done means: with the Browser connector enabled, every engine (pi, omp, codex, ACP) lists
`web_search` and `web_fetch` on the `nucode-browser` connector; calling them returns text
without starting Chromium, creating a native tab, or setting browser agent activity; both are
auto-approved like the other read-only browser tools; Chat mode with Web on can use them; the
transcript renders them as "Searched …" / "Read …".

## Design (settled — do not redesign)

The tools are served by the existing `nucode-browser` MCP launcher
(`apps/nucode/src-tauri/src/browser/launcher.rs`), which is the one place all engines share.

1. **New module `apps/nucode/src-tauri/src/browser/web.rs`** holding everything HTTP:
   - `tools() -> Vec<Value>`: the two MCP tool definitions (below).
   - `search(client, endpoint, query, count) -> Result<String, String>`
   - `fetch(client, settings, url, offset, max_chars) -> Result<String, String>`
   - pure helpers (`parse_results(html)`, `page_text(html, base)`), unit-tested.
2. **Listing.** `backend::filter_tools` currently only edits the list for the native backend.
   Make the `web_*` tools appear **first** in the `tools/list` result for both backends (native
   and CDP/Playwright), and append the browser-steering sentence (below) to `browser_navigate`'s
   description for both backends.
3. **Calling.** In `launcher::proxy`, a `tools/call` whose name is `web_search` or `web_fetch` is
   handled **before** `browser.request({"action":"ensure"})`. It must not call `ensure`, must not
   touch `activity`, `calls`, `pending` or `agentTab`, and must not be forwarded to Playwright.
   Run it so a slow request does not block the proxy loop (other requests keep flowing), and a
   `notifications/cancelled` for its id drops it without emitting a result. Errors are returned as
   `{"isError":true,"content":[{"type":"text","text":…}]}` like the existing native path.
4. **Search backend.** No accounts, no API keys (hard product rule). GET
   `https://html.duckduckgo.com/html/?q=<query>` with a desktop Safari User-Agent, 15 s timeout.
   Parse results from the HTML: anchor `a.result__a` (title + href) and `.result__snippet`.
   hrefs are redirect links of the form `//duckduckgo.com/l/?uddg=<percent-encoded target>&…` —
   decode to the real URL; drop ad results (`y.js` / `ad_domain` links). Output plain text:

   ```
   1. <title>
      <url>
      <snippet>
   ```

   `count` default 8, max 20. A non-200 status, a challenge page, or zero parsed results is an
   error: `Web search is unavailable right now (<reason>). Try again, or use browser_navigate
   with a search URL.` The endpoint is a parameter so tests never hit the network.
5. **Fetch.** GET the URL with the same User-Agent; no cookies, no credentials, nothing from the
   user's browser sessions. Only `http`/`https`. Follow at most 5 redirects **manually** and
   check every hop (including the first) with `policy::allowed_origin(url, settings)` so the
   user's blocked/allowed origin lists from Settings → Browser apply; a refused hop errors with
   `Blocked by browser origin settings: <origin>`. 20 s total timeout, body capped at 5 MB
   (stream and stop; do not buffer unbounded). Accept `text/*`, `application/json`,
   `application/xml`, `application/xhtml+xml` (and `+json` / `+xml` suffixes); anything else
   errors with `Unsupported content type <type>; use browser_navigate to view it.` HTML is
   converted to readable text (no script/style/noscript/svg/template content, block elements on
   their own lines, links kept as `text (absolute-url)` when the URL differs from the text,
   whitespace collapsed); non-HTML text is returned as is. Result:

   ```
   URL: <final url>
   Title: <title, when HTML has one>

   <text slice>
   ```

   `max_chars` default 20000 (clamp 1000..=100000), `offset` default 0, both counted in chars of
   the extracted text (slice on char boundaries). When more remains, end with
   `[Truncated: <n> more characters. Call web_fetch again with offset=<next>.]`. When an HTML page
   yields under 200 characters of text, end with `[This page has little static text; it may need
   JavaScript. Use browser_navigate if you need it rendered.]`.

   For HTML→text you may add one small dependency (`html2text`, default features only if they are
   needed) **or** write it with the `regex` crate already in `Cargo.toml` — whichever gives the
   behaviour above in less code. Do not add any other crate. `reqwest` 0.12 (rustls, stream) is
   already a dependency; build one client with redirects disabled.

### Tool definitions (exact names; descriptions may be tightened but must keep the steering)

- `web_search` — "Search the web in the background, without opening the browser. Returns result
  titles, URLs and snippets. Use this first whenever you need to look something up."
  Input: `query` (string, required), `count` (integer 1–20, optional).
- `web_fetch` — "Fetch a public web page in the background, without opening the browser, and
  return its readable text. Use this to read search results, documentation and articles. It does
  not run JavaScript and does not use the user's sign-ins."
  Input: `url` (string, required), `offset` (integer ≥ 0, optional), `max_chars` (integer,
  optional).
- Sentence appended to `browser_navigate` (both backends): "This opens the page in the user's
  visible in-app browser: use it only when the user asks for the browser, or a page needs
  sign-in, interaction or JavaScript. To look something up or read a public page, use web_search
  and web_fetch instead."
  In the existing native-only note, change "check browser_tabs, search, or ask" to
  "check browser_tabs, use web_search, or ask".

## Files

Modify / create (paths relative to the repo root):

- `apps/nucode/src-tauri/src/browser/web.rs` (new), `browser/mod.rs` (module, `READ_TOOLS` gains
  `web_search`, `web_fetch`), `browser/backend.rs` (`filter_tools`), `browser/launcher.rs`
  (dispatch), `browser/tests.rs` or tests inside `web.rs`.
- `apps/nucode/src-tauri/Cargo.toml` / `Cargo.lock` only if `html2text` is added.
- Chat mode with Web on currently allows exactly `browser_navigate`, `browser_snapshot`,
  `browser_take_screenshot` in three places — add the two new tools to each:
  `apps/nucode/src-tauri/src/shared/pi/mod.rs` (the allowlist near `connector.tool_allowlist`
  and the `--tools` argument), `apps/nucode/engines/pi/extensions/nucode-gate.ts`.
- `apps/nucode/engines/pi/extensions/lib/connectors.ts`: the auto-allow list for
  `nucode-browser` gains the two tools (it mirrors `READ_TOOLS`).
- Frontend:
  - `apps/nucode/src/features/app/hooks/useBrowserController.ts`: an `mcpToolCall` from the
    browser connector whose `tool` is `web_search` or `web_fetch` must **not** count as browser
    agent activity (no banner, no take-over target).
  - Find anything else that opens, reveals or focuses the browser panel when a `nucode-browser`
    tool call starts, and make it ignore these two tools.
  - `apps/nucode/src/features/messages/utils/messageRenderUtils.ts` (+ `toolIcon.ts` if needed):
    `web_search` renders as verb "Searched", target = the query, category `search`;
    `web_fetch` renders as verb "Read", target = short URL (reuse `shortUrl`), with the same
    globe icon the built-in `webSearch` item uses. They must not be grouped/labelled as browser
    steps.
- Tests next to each change: `browser` Rust tests, `shared/pi/tests.rs`,
  `shared/acp/tests.rs`, `shared/connectors_tests.rs`, `engines/pi/tests/chat.test.ts`,
  `engines/pi/tests/connectors.test.ts`, `describeTool.test.ts`, and a
  `useBrowserController` test if one exists (add a small one otherwise).

## Constraints

- Follow the surrounding code style: dense Rust, `Result<_, String>`, `serde_json::json!`, no new
  abstractions (no traits or config structs for a "search provider"), no settings UI, no new
  settings fields.
- No account, API key or login flow of any kind. No telemetry.
- Rust tests must not need the network or bind a local port (the sandbox blocks both): test the
  pure parsers with inline HTML fixtures, the content-type/redirect/origin decisions as pure
  functions, `filter_tools` output for native and non-native, and the truncation/offset maths.
- `supported_tools()` is the native browser tool list; do not add the web tools to it (they are
  not dispatched through `backend::tool`).
- Do not hand-edit generated files under `packages/protocol`.
- The repository is public: no personal names, home-directory paths or machine names in code,
  comments, tests or fixtures.
- Keep the diff small; if a requirement can be met by adding to an existing list, do that.

## Verification

Run from the repo root; `TMPDIR` must be the repo's own `.tmp` directory (create it):

```
mkdir -p .tmp
( cd apps/nucode/src-tauri && TMPDIR="$PWD/../../../.tmp" cargo test --lib -- browser:: shared::pi shared::acp shared::connectors )
( cd apps/nucode/engines/pi && npm test )
( cd apps/nucode && npm run typecheck && npx vitest run src/features/messages src/features/app src/features/work )
```

If a Swift build script fails with "precompiled file … module cache path", run
`cargo clean -p apple-cf -p apple-metal -p screencapturekit` in `apps/nucode/src-tauri` once and
retry. Known unrelated failures: `multiwebview_tests::no_single_webview_assumptions_in_app_sources`
and any test that needs to bind localhost under the sandbox — report these, do not "fix" them.

## Out of scope

- Other search providers, a provider setting, or API-key based search.
- Making search available when the Browser feature/connector is turned off.
- Any change to the native browser, Playwright runtime, snapshot or navigation behaviour.
- Committing: leave the changes uncommitted in the working tree.
