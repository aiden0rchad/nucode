# M30: drag and drop into the composer, image-only attachment previews, scrolling up while a reply streams

All paths are relative to `apps/nucode/` unless they start with `docs/`.

## Goal

Three user-visible changes, done when all three hold in Code, Chat and Work modes:

1. **Drag and drop works, for any file.** Dropping files from Finder onto the composer attaches them. Image files
   become image attachments (as today's paste and the attach button do). Any other file or folder inserts its path
   into the message text at the caret: relative to the project folder when the file is inside it, absolute otherwise,
   wrapped in double quotes when it contains a space, each followed by one space. Several dropped files are handled in
   one drop (images attach, the rest insert their paths in drop order).
2. **Attachments show as pictures, not as file names.** The attachment row is a strip of square thumbnails above the
   text area, inside the composer, which grows to fit it. No file name text.
3. **The transcript can be scrolled up while a reply is streaming.** Today every new token pulls the view back to the
   bottom unless the user manages to scroll more than the "near bottom" threshold in one go.

## Background you need

- The main UI runs in a **child webview** of the main window (Tauri `unstable` multiwebview; see
  `src-tauri/src/lib.rs` and `src-tauri/src/window_layout.rs`). `src/services/dragDrop.ts` subscribes with
  `getCurrentWindow().onDragDropEvent(...)`. For child webviews Tauri delivers drag-and-drop events to the *webview*
  target, not the window target, so this subscription most likely never fires in the real app. Confirm in the Tauri
  source that cargo has vendored (search the cargo registry for `DRAG_DROP_EVENT` / `emit_to_webview` in the `tauri`
  crate, and `WebviewKind` in `tauri-runtime-wry`) before changing anything, and write what you found in your report.
  The likely fix is to subscribe on `getCurrentWebview()` from `@tauri-apps/api/webview`. Do not subscribe on both in a
  way that can deliver one drop twice.
- Positions in these events are physical pixels relative to the webview; `useComposerImageDrop.ts` already
  normalizes them. Keep that working.
- Existing pieces: `src/features/composer/hooks/useComposerImageDrop.ts` (drop zone, image filter),
  `useComposerImages.ts`, `src/features/composer/components/ComposerAttachments.tsx` (the row to restyle),
  `ComposerInput.tsx` (HTML drop handlers), `src/features/chat/ChatView.tsx` and `src/features/work/WorkView.tsx`
  (their own composers and drop handling), `src/features/workspaces/hooks/useWorkspaceDropZone.ts` (dropping folders
  on the sidebar to add projects: must keep working and must not also insert paths into the composer).
- Auto-scroll lives in `src/features/messages/components/useMessagesViewState.ts` (`autoScrollRef`,
  `updateAutoScroll`, `requestAutoScroll`, the layout effect keyed on `scrollKey`). Work mode draws its own
  transcript in `src/features/work/WorkView.tsx`; Chat mode in `src/features/chat/`. Check how each scrolls and fix
  all that have the problem.

## Design

### Drop

- One drop anywhere over the composer surface counts (text area, attachment strip, toolbar row). Keep the existing
  drop highlight; make sure it also shows for non-image files.
- Image detection stays by extension (the existing list).
- Path insertion goes through the same code path as typing (so drafts, undo and the send button state update).
- When no project folder is known (Chat mode), insert absolute paths.
- A drop while the composer is disabled does nothing.

### Thumbnails

- Each attachment is an 88×88 px tile, `border-radius: 10px`, `object-fit: cover`, 1px subtle border
  (`var(--border-subtle)`), 8px gap, in one row with horizontal scrolling when the row is wider than the composer
  (no wrapping, thin or hidden scrollbar). The strip has 10px padding above and aligns with the text area's left edge.
- The remove button is a 20px round button at the tile's top-right corner (inset 4px), visible on hover and on
  keyboard focus of the tile or the button, always visible when `(hover: none)`. It keeps its accessible name
  `Remove <file name>`.
- The file name is not rendered as text. Keep it as the tile's `title` and in the image's `alt` so it is still
  available to assistive tech and on hover.
- If the image cannot be previewed (no preview URL, or the `<img>` fails to load), the tile shows the existing image
  icon centered on `var(--surface-card)` with the file name under it in 11px text, truncated to one line. This is
  the only case where a name is shown.
- Keep the existing larger hover preview if there is one that works; otherwise clicking a tile does nothing.
- Use existing design tokens (`src/styles/ds-tokens.css`); no new colors. The rest of the composer layout is frozen:
  do not move, resize or restyle anything else in it.

### Scrolling

- Track whether the user has detached from the bottom, separately from "is near the bottom":
  - Detach immediately on a `wheel` event with `deltaY < 0`, on `touchmove` that moves content down, on
    PageUp / ArrowUp / Home when the transcript has focus, and on any `scroll` event where `scrollTop` decreased and
    the distance from the bottom is more than 1px afterwards (covers dragging the scrollbar).
  - Re-attach when the user scrolls to within the existing near-bottom threshold while moving down, when the thread
    changes, and when the user sends a message.
  - While detached, nothing scrolls the transcript on new content. While attached, behaviour is as today.
- Content shrinking at the bottom (a collapsing tool group, the thinking row disappearing) must not count as the user
  scrolling up.
- Loading older history at the top keeps its current anchor behaviour.
- Put the logic in one small hook and use it wherever a transcript auto-scrolls, rather than copying it.

## Files

- Modify: `src/services/dragDrop.ts`, `src/features/composer/hooks/useComposerImageDrop.ts` (rename only if the
  rename stays inside this change), `src/features/composer/components/ComposerAttachments.tsx`,
  `src/features/composer/components/ComposerInput.tsx`, `src/styles/composer.css`,
  `src/features/messages/components/useMessagesViewState.ts`, the Chat and Work views as needed.
- Create: the scroll hook and its test; tests for the new drop behaviour and the attachment tiles.
- Off-limits: everything under `src/features/settings/`, `src/styles/settings.css`,
  `src/features/app/components/Sidebar*`, `ThreadRow.tsx`, `WorkspaceCard.tsx`, `src/features/app/hooks/useSidebarMenus.ts`,
  `src/styles/sidebar.css` (other work is in progress there), and all Rust. If drag and drop needs a Rust or Tauri
  config change, stop and say exactly what is needed in your report instead of making it.

## Constraints

- Follow the surrounding code style; match how neighbouring tests are written (vitest + Testing Library).
- No new dependencies.
- The repository is public: no personal names, home-directory paths, hostnames or project names from this machine in
  code, tests, comments or commit messages. Use neutral sample paths such as `/projects/demo/src/app.ts`.
- Commit your work on the current branch in small commits with imperative subject lines. Do not push.

## Verification

Run from `apps/nucode/`, and keep going until all pass:

```
npm run typecheck
npx eslint src --ext .ts,.tsx
npx vitest run --testTimeout=30000
```

New tests must cover at least: a drop delivered through the webview subscription reaches the composer; an image
drop attaches and a non-image drop inserts the right path (inside the project → relative, outside → absolute, with a
space → quoted); tiles render without name text and the remove button keeps its name; the fallback tile shows the
name; wheel-up during streaming stops auto-scroll and scrolling back to the bottom resumes it; content shrink at the
bottom does not detach.

## Out of scope

Pasting, the attach button, attachment types the engines accept, the composer's other controls, any visual change
outside the attachment strip, and anything in the off-limits list.

## Report

List what you changed, what you found in the Tauri source about where drag-and-drop events are delivered, anything
you could not do or could not verify (drag and drop cannot be exercised end to end outside the real app: say so), and
the final output of the three verification commands.
