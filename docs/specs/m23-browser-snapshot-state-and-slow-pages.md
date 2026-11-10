# M23 — Snapshot form state, scroll row label, slow-page navigate

Found during the real-site evaluation (F30–F32).

## 1. Snapshot shows checked/selected state (F30)
`src-tauri/src/browser/native/bridge.js` snapshot items carry `el.value`, so a checkbox reads `value="on"`
whether ticked or not, and a `<select>` shows the option value, not what the user sees. For
`input[type=checkbox|radio]` drop `value` and set `checked: el.checked`; for `<select>` set `value` to the
selected options' labels joined by ", ". Elements with `aria-checked`/`aria-expanded` get `checked`/`expanded`
from the attribute. `compact_snapshot` in `backend.rs` appends ` checked`/` unchecked` and
` expanded`/` collapsed` when present.

## 2. `browser_scroll` row label (F31)
`src/features/messages/utils/messageRenderUtils.ts` `BROWSER_VERBS` lacks `browser_scroll`, so the row reads
"Used browser scroll". Add `browser_scroll: ["Scrolled", ["ref"]]`.

## 3. Slow pages don't fail `browser_navigate` (F32)
`NativeBackend::navigate` waits 20 s and then returns the error "The page is still loading; try again in a
moment" although the navigation started and usually finishes later. On timeout return the tab as it is plus
`"note": "Still loading after 20 s. Check with browser_snapshot or browser_wait_for."`. Errors (blocked,
tab closed) stay errors.

## Verification
`cargo test --lib browser::` (from `apps/nucode/src-tauri`, usual env) and
`npx vitest run src/features/messages src/features/browser` (from `apps/nucode`).
