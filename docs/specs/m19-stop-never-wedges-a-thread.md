# M19 — Stopping a turn must never wedge the thread or drop the next message

## What happened (real app, omp engine, 2026-11-09)
1. User clicked Stop while the agent was mid tool call (it was reading a large stored tool result /
   `eval`). The UI immediately showed "Session stopped." (`interruptThread` in
   `src/features/threads/hooks/useThreadMessaging.ts` marks the thread idle before the engine confirms).
2. The engine got `{"type":"abort"}` (`src-tauri/src/shared/pi/mod.rs`, `"turn/interrupt"`), but the turn
   never settled: for omp, `process.rs::receive` only synthesizes `agent_settled` from `session_settled` /
   `prompt_result{sessionSettled:true}`, and none arrived. So `translate.rs` never emitted `turn/completed`.
3. The checkpoint manager (`src-tauri/src/shared/checkpoints/mod.rs`) keeps `(workspace, thread)` in
   `state.active` from `before()` until it observes `turn/completed`. Every later `turn/start` failed with
   "Thread is running" — 6+ minutes later, and every Retry added another "Request couldn't complete" card
   ("Couldn't restart the request. Your message is still available.") while the typed message was gone
   (not in the composer, not shown as a bubble). The thread was unusable until the app restarted.

## Goal
- After Stop, a pi/omp turn always settles within a bounded time, emitting `turn/completed` (status
  `interrupted`) so checkpoints, `running`, and the UI converge.
- A message sent while the previous turn is still stopping is queued and sent once it settles, never lost.
- If a send is still rejected, the user's text is preserved and the error is understandable.

## Changes
1. **Interrupt watchdog** (`src-tauri/src/shared/pi/mod.rs` + `process.rs`/`translate.rs` as needed): after
   the `abort` request for `turn/interrupt` returns (or errors), spawn a task that waits up to 8 s for the
   process's `running` flag to clear (use a `tokio::sync::Notify`/watch set where `running` is stored, not a
   sleep loop). If it is still running, force settlement through the normal path: lock the translator,
   `apply(&json!({"type":"agent_settled","aborted":true}))`, emit the resulting events with the process's
   `emit`, and clear `running`. Also do this when the engine process exits while a turn is active (check
   whether that path already settles; if not, add it). Don't double-settle (translator `settle` already
   no-ops when inactive). Unit test with a fake process/translator: abort without settlement → after the
   (injectable, short in tests) timeout a single `turn/completed` with status `interrupted` is emitted and
   `running` is false; abort followed by a real `session_settled` → no extra settlement.
2. **Checkpoint safety net** (`checkpoints/mod.rs`): `before()` must not reject forever. If `active` has the
   key but `observe` has seen `turn/completed`/`thread/status/changed{type:idle}` for that thread since,
   clear it (handle `thread/status/changed` idle in `observe` the same as completion when the entry is still
   active), so a lost completion can't wedge the thread. Tests: idle status clears a stale entry; a fresh
   `before()` then succeeds.
3. **Frontend "stopping" state** (`useThreadMessaging.ts` and the thread state reducer): after Stop, keep a
   per-thread `stopping` flag until `turn/completed` or `thread/status/changed` idle arrives for that thread
   (with a 15 s fallback that clears it). While stopping, the composer's Send queues the message exactly like
   while running (the existing queued-message UI), and it is dispatched when the thread settles. Tests.
4. **Never drop text on a rejected send**: when `turn/start` fails before the turn starts (error returned
   from `sendMessageToThread`), restore the message text into the composer draft for that thread if the
   draft is empty (otherwise keep it as the failed request so Retry resends it), and map
   `/Thread is running/` in `describeTurnError` (`src/features/messages/components/TurnErrorCard.tsx`) to
   title "Still finishing the previous turn" / description "Wait a moment, then retry. Your message is kept."
   with Retry enabled. Repeated identical failures must not stack more cards — replace the previous card for
   the same failed request. Tests.

## Files
`src-tauri/src/shared/pi/{mod.rs,process.rs,translate.rs}` (+ `src/shared/pi/tests.rs`),
`src-tauri/src/shared/checkpoints/mod.rs` (+ its tests),
`src/features/threads/hooks/useThreadMessaging.ts` (+ reducer/state files it uses and tests),
`src/features/messages/components/TurnErrorCard.tsx` (+ tests). Off-limits: browser code, other specs.

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib shared::pi:: && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib checkpoints
```
From `apps/nucode`: `npx tsc --noEmit && npx vitest run src/features/threads src/features/messages src/features/app`.
All must pass.
