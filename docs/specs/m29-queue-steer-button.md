# M29 — "Steer" button on queued messages

## Goal

While an agent turn is running, follow-up messages wait in the **Queued** list above the composer
(`ComposerQueue`). Today the only ways to steer are the global "Follow-up behavior" setting and
Shift+Cmd+Enter at send time; a message that is already queued can only be edited or deleted.

Add a **Steer** button to each queued message. It appears when the pointer is over the row (or the
row has keyboard focus) and sends that message into the running turn right away, using the existing
steer path, instead of waiting for the turn to finish. The queue list itself keeps its current look.

Done means: hovering a queued row during a running turn shows "Steer"; clicking it removes the row
and steers the turn with that message (text and images); if the steer fails the message goes back
to the front of the queue; the button is absent when steering is not possible.

## Design (settled — don't redesign)

### 1. `apps/nucode/src/features/threads/hooks/useQueuedSend.ts`

Add to the result type and implement:

```ts
steerQueuedMessage: (threadId: string, messageId: string) => Promise<void>;
```

- No-op unless `threadId === activeThreadId`, the item exists in `queuedByThread[threadId]`,
  `isProcessing && !isStopping && steerEnabled && Boolean(activeTurnId)` (the same condition as
  `canSteerCurrentTurn` in `handleSend`), and the item's text is not a slash command
  (`parseSlashCommand(item.text.trim()) === null`).
- Otherwise: `removeQueuedMessage(threadId, messageId)`, then
  `const result = await sendUserMessage(item.text, item.images ?? [], { sendIntent: "steer" })`.
  If `result.status === "steer_failed"`, put the same item back with the existing
  `prependQueuedMessage(threadId, item)`. If `sendUserMessage` throws, also put it back, then rethrow
  nothing (swallow; the messaging layer already reports the error).

### 2. Handler and wiring

- `apps/nucode/src/features/app/hooks/useComposerController.ts`: next to `handleDeleteQueued`, add
  `handleSteerQueued = (id: string) => { if (activeThreadId) void steerQueuedMessage(activeThreadId, id); }`
  (useCallback like its neighbours) and return it.
- `apps/nucode/src/features/app/hooks/useMainAppLayoutSurfaces.ts` (where `onEditQueued` /
  `onDeleteQueued` are passed): pass `onSteerQueued: handleSteerQueued` **only** when steering is
  possible right now — the thread is processing and the existing `steerAvailable` value
  (`useMainAppComposerWorkspaceState.ts`: `!isStopping && settings.steerEnabled && Boolean(activeTurnId)`)
  is true; otherwise pass `undefined`. Thread whatever value is needed through the existing prop
  objects; do not add a second source of truth for "can steer".
- `apps/nucode/src/features/composer/components/Composer.tsx`: accept `onSteerQueued?: (id: string) => void`
  and pass it to `ComposerQueue` beside `onEditQueued` / `onDeleteQueued`.
- `WorkView.tsx` also renders `ComposerQueue`; leave it without the new prop (no button there).

### 3. `apps/nucode/src/features/composer/components/ComposerQueue.tsx`

- New optional prop `onSteerQueued?: (id: string) => void`.
- A row is steerable when `onSteerQueued` is set and `!item.text.trimStart().startsWith("/")`.
- For a steerable row render, between the text and the `…` menu:
  ```tsx
  <button type="button" className="composer-queue-steer" title="Send now: the agent reads it at its next step"
    aria-label="Steer: send this message now" onClick={() => onSteerQueued(item.id)}>
    <CornerDownRight aria-hidden /> Steer
  </button>
  ```
  (`CornerDownRight` from `lucide-react`, imported the way this file imports `Ellipsis`.)
- In the `…` menu, add `Steer now` as the first `PopoverMenuItem` for steerable rows (closes the menu,
  calls `onSteerQueued(item.id)`), so the action is reachable without hover.

### 4. `apps/nucode/src/styles/composer.css`

Beside the existing `.composer-queue-*` rules:

- `.composer-queue-steer`: inline-flex, gap 4px, `flex: 0 0 auto`, font-size 11px, padding 2px 8px,
  border-radius 6px, `border: 1px solid var(--border-muted)`, background transparent,
  `color: var(--text-stronger)`, cursor pointer; its svg 12px. Hover/focus-visible: background
  `var(--surface-hover)`.
- Hidden until wanted without changing the row's height: `opacity: 0; pointer-events: none;` by
  default; `.composer-queue-item:hover .composer-queue-steer`,
  `.composer-queue-item:focus-within .composer-queue-steer` → `opacity: 1; pointer-events: auto;`.
  Under `@media (hover: none)` it is always visible. Use only theme tokens already used in this file
  or `ds-tokens.css`; no hard-coded colours.

## Files

- Modify: `src/features/threads/hooks/useQueuedSend.ts` (+ `useQueuedSend.test.tsx`),
  `src/features/app/hooks/useComposerController.ts`, `src/features/app/hooks/useMainAppLayoutSurfaces.ts`
  (and the minimum of its callers/types needed to reach `steerAvailable` and `isProcessing`),
  `src/features/composer/components/Composer.tsx`, `src/features/composer/components/ComposerQueue.tsx`
  (+ `ComposerQueue.test.tsx`), `src/styles/composer.css`. All paths under `apps/nucode/`.
- Off-limits: Rust (`src-tauri`), engine extensions, `WorkView.tsx`, `.github/`, `docs/` other than
  this spec, generated `packages/protocol`.

## Constraints

- Match surrounding style in each file. No new dependencies.
- Public repository: no personal names, home paths, hostnames or real provider/model names.
- Commit nothing; leave the changes in the working tree.

## Verification

From `apps/nucode`:

```
npm run typecheck
npx vitest run src/features/composer src/features/threads src/features/app src/dev
```

Required new tests:

- `ComposerQueue.test.tsx`: with `onSteerQueued`, a normal row has a "Steer: send this message now"
  button that calls it with the row's id, and the `…` menu starts with "Steer now"; a row whose text
  starts with `/` has neither; without the prop no Steer control renders.
- `useQueuedSend.test.tsx`: `steerQueuedMessage` removes the item and calls `sendUserMessage` with
  the item's text, images and `{ sendIntent: "steer" }`; a `steer_failed` result puts the item back
  first in the queue; it does nothing when not processing, when `steerEnabled` is false, for another
  thread's id, and for a queued slash command.

## Out of scope

- Changing what a steer does inside the engines, the Follow-up behavior setting, the Work view's
  queue, reordering queued messages.
