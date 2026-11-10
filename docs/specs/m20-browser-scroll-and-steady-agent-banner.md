# M20 — Advertise browser_scroll; keep the "Agent is using the browser" banner steady

## 1. `browser_scroll` is implemented but never offered
`src-tauri/src/browser/backend.rs`: `supported_tools()` lists `browser_scroll` and `tool()` handles it
(`backend.scroll(args)` → bridge.js op `scroll` with `x`, `y`, `ref`), but `filter_tools(…, native=true)`
only *retains* tools that the pinned Playwright MCP lists, and Playwright has no `browser_scroll`. In a real
run the agent was told to scroll and got `No such tool: xd://mcp__nucode_browser_browser_scroll`.
Fix: in `filter_tools` for the native backend, append a `browser_scroll` tool when it is absent:
description "Scroll the page by x/y pixels, or scroll an element (snapshot ref or selector) into view.";
inputSchema `{type:object, properties:{x:{type:number,description:"Horizontal pixels (+right)"},
y:{type:number,description:"Vertical pixels (+down)"}, ref:{type:"string",description:"Snapshot ref or
unique selector to scroll into view"}}, additionalProperties:false}`. Check bridge.js's `scroll` op accepts
exactly these (adapt the schema to what it really takes). Make sure the launcher's tool listing path
(`launcher.rs` → `filter_tools`) and omp's inline docs (M13: `tools.xdevInlineDevices`
`mcp__nucode_browser_*`) pick it up. Test: native listing contains `browser_scroll` with that schema; CDP
listing unchanged; `tool(…,"browser_scroll",{y:400})` reaches `scroll`.

## 2. Steady agent banner
`launcher.rs` sends `{"action":"activity","active":true}` before and `false` right after every native tool
call, so the pane's "Agent is using the browser / Take over" banner flickers for ~1 s per call and the user
can't press Take over. Make the inactive transition lazy: on call end, schedule `active:false` 4 s later and
cancel it if another tool call starts first (a generation counter + `tokio::time::sleep`, no busy loop);
`notifications/cancelled` and proxy shutdown still clear it immediately. Test the debounce with a fake
`browser.request` recorder (calls in quick succession → one true, one delayed false).

## Files
`src-tauri/src/browser/{backend.rs,launcher.rs,native/bridge.js (only if the scroll op needs it)}` + tests.
Off-limits: everything else.

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib browser::
```
