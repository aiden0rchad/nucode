# M33: Settings redesign

All paths are relative to `apps/nucode/` unless they start with `docs/`.

## Goal

Every Settings screen looks like it belongs to one carefully designed product: one page layout, one group card, one
row recipe, one set of controls, a calm navigation list, and labels a new user understands without decoding. The
bar is the settings of the best desktop apps (Linear, Raycast, macOS System Settings, the Codex and Claude desktop
apps). Independent reviewers will score screenshots from 1 to 10; this work is done when they give 8 or more, so
judge your own screenshots hard before you report.

No setting changes behaviour: every control keeps its stored key, values, default and handler. This is a visual and
wording change plus a reordering of the navigation.

## Background you need

- Shell: `src/features/settings/components/SettingsView.tsx` (modal, title bar, master/detail),
  `SettingsNav.tsx` (`SETTINGS_GROUPS`, icons), labels in `settingsViewConstants.ts`.
- Sections: `src/features/settings/components/sections/*.tsx` (22 of them) plus the Evals and Diagnostics views that
  Settings embeds.
- Primitives: `src/features/design-system/components/settings/SettingsPrimitives.tsx` (`SettingsPage`,
  `SettingsSection`, `SettingsGroup`, `SettingsRow`, `SettingsToggleRow`, `SettingsSelect`, segmented control,
  `SettingsSubsection`, buttons). They exist but are used unevenly, and `src/styles/settings.css` (about 1,400 lines)
  holds an older layer of rules with a newer layer of overrides on top of it.
- Theme variables: `src/styles/themes.dark.css`, `themes.dim.css`, `themes.system.css` (light). Use the existing
  variables (`--surface-card`, `--surface-control`, `--surface-control-hover`, `--border-muted`, `--border-strong`,
  `--text-strong`, `--text-subtle`, `--text-faint`, the accent variables) so all three themes come out right.
- `src/styles/uiAudit.test.mjs` checks style rules; keep it passing and extend it if you add a rule it should guard.

## What is wrong today (fix all of these everywhere, not only where named)

1. Rows are built several ways: controls float mid-row, help text sits under the control or in a bordered box inside
   the row, some rows have dividers and some do not, paddings differ.
2. The content column changes width from section to section (some stop near 760px, some stretch the full width), and
   there are large empty gaps between the page subtitle and the first group.
3. Inputs, selects and text areas are near-black holes on a grey card and are far wider than their content.
4. Several button styles; buttons whose labels wrap onto two or three lines (Server).
5. Cards inside cards and repeated headings (Providers); a meaningless default group title "Preferences".
6. Shortcuts spends a line per row on "Default: …" and shows a "Clear" button on every row.
7. Navigation: a gradient pill for the active item, "Codex flags" as an indented child, one group ("Core") with
   eleven items, the last items fading out under the fold.
8. Wording that does not match the rest of the app or explains nothing ("Groups" where the sidebar says sections,
   "Copies folder", "Open in", engine-internals in descriptions).

## Design

### Shell and navigation

- Keep the modal size and the title bar. The detail pane scrolls; the navigation scrolls on its own.
- Navigation column 232px. Search field at the top: 32px tall, leading search icon, same field style as every other
  input (see Controls).
- Group labels: 12px, weight 600, `--text-faint`, 16px above and 6px below, not upper-case.
- Items: 32px tall, 8px radius, 13px label, 16px icon in `--text-subtle`, 10px gap, 8px horizontal padding, 2px
  between items. Hover: `--surface-control`. Active: a flat tint of the accent (about 14% accent over the
  navigation background), label `--text-strong` at weight 600, icon in the accent color. No gradient, no shadow, no
  indented children. Keyboard focus ring visible.
- New grouping and order (ids unchanged; hidden-by-feature sections stay hidden as today):
  - **General**: Appearance, Display & Sound, Composer, Shortcuts, Dictation, Features
  - **Models**: Providers, Models & Agents, Engines, Connectors
  - **Projects**: Projects, Environments, Git, Open in apps (label change from "Open in")
  - **Tools**: Browser, Computer Use
  - **Advanced**: Codex flags, Server, Evals, Diagnostics, Import, About
- Settings still opens on the same default section as today.

### Page

- One content column for every section: `max-width: 720px`, centered in the detail pane, padding 28px 32px 48px.
  Sections that embed a wide tool (Evals, Diagnostics) may use up to 880px, with the same header.
- Page header: title 20px weight 600; description 13px `--text-subtle`, at most two lines, 6px under the title;
  optional header actions right-aligned on the title line; 24px between the header and the first group.
- Tabs inside a page (Models & Agents) sit directly under the header as a segmented control, 20px above the first
  group.

### Group

- Optional group title: 13px weight 600 `--text-strong`; optional one-line description 12px `--text-subtle` under
  it; optional actions (small buttons) right-aligned on the title line; 8px between the title block and the card;
  28px between groups.
- A page with a single group shows no group title (the page title is enough). Remove the default "Preferences"
  title; never invent filler titles.
- Card: `--surface-card`, 1px `--border-muted`, radius 12px, no shadow, rows separated by 1px `--border-muted`
  lines. Never a card inside a card: nested content becomes rows, or an indented sub-row group with a 1px left rule.

### Row (the one recipe)

- Grid: text block on the left (`minmax(0, 1fr)`), control on the right (`auto`, right-aligned, vertically
  centered), 16px gap, padding 12px 16px, min-height 52px.
- Text block: label 13px weight 500 `--text-strong`; description 12px `--text-subtle`, directly under the label, 2px
  gap, at most two lines where the wording allows. Descriptions say what the setting does for the user in plain
  words. Help text never goes under the control and never in a bordered box.
- Stacked row: when the control needs room (text area, path or URL field, code/command field, a list editor) the
  label and description come first and the control spans the full row width under them with 8px gap.
- Dependent rows (settings that only matter when a switch above is on) are disabled, not hidden, unless they are
  hidden today.
- A callout is only for something that needs attention (warning, error, a required next step): no border, a 10%
  tint of the status color, 16px icon, 12px text, radius 8px, inside the row's text column or as a full-width row.
  Neutral explanations are row descriptions.

### Controls (one of each)

- Text input, select, text area, search: height 32px (text areas min 72px), radius 8px, background
  `--surface-control`, 1px `--border-muted`, 13px text, 10px horizontal padding; hover border `--border-strong`;
  focus: 2px accent ring; disabled: `--surface-control-disabled` and `--text-faint`. Monospace only for code,
  commands, paths and origins.
- Widths in a normal row: select fits its longest option between 140px and 260px; short text or number inputs
  120–240px. Nothing in a normal row is wider than 260px; wider content uses a stacked row.
- Switch: keep the current size and accent; the off state must be clearly visible in all themes.
- Segmented control: 30px tall, `--surface-control` track, selected segment on `--surface-card` with a 1px border,
  13px labels.
- Buttons, 28px tall in rows and headers (32px for a page's primary action), 12px/13px weight 500, radius 8px,
  `white-space: nowrap`:
  - primary: accent fill;
  - secondary: `--surface-control` fill, 1px `--border-muted`;
  - ghost: no fill until hover;
  - danger: as secondary with the danger text color, danger-tinted on hover.
  At most two text buttons side by side in a row; further actions go into a "…" menu or become icon buttons with
  tooltips. Scope these rules to Settings; do not change the app-wide button styles.
- Keycap: each key of a shortcut is its own chip (22px tall, min-width 22px, 6px radius, `--surface-control`, 1px
  `--border-muted`, 12px).
- Status: one small dot (8px) plus 12px text ("Ready · v1.4.0", "Not tested", "Stopped"), not rows of grey chips.

### List rows (engines, providers, connectors, projects, environments, apps)

- 28–32px leading icon tile, name 13px weight 500 with any badge ("Default") after it, one meta line under it
  (12px `--text-subtle`), trailing controls right-aligned (switch, then a "…" or chevron). Same padding and dividers
  as the row recipe. Drag handles or reorder arrows only show on hover/focus.
- Empty lists: 13px `--text-subtle` sentence centered in the card with one secondary button.
- "Add …" actions live in the group header on the right, as a secondary button with a plus icon.

### Per-section notes

- **Shortcuts**: each row is label left, shortcut on the right as keycaps inside a button that starts recording
  (recording state: accent ring and "Press keys…"); an unset shortcut shows "Not set" in `--text-faint`. Remove the
  "Default: …" line. A reset icon button appears only when the value differs from its default (tooltip names the
  default); a clear icon button appears on row hover and keyboard focus only when a value is set. Keep whatever
  keyboard handling exists today. Group rows by area under group titles.
- **Providers**: one list of providers (list rows); details of a provider open as rows under it or in the existing
  editor, without a second card or repeated heading.
- **Models & Agents**: "Save policy" moves to the page header actions (primary, disabled while nothing changed, if
  that state exists today; otherwise always enabled). The "Effective policy …" disclosure is a left-aligned
  collapsible group at the bottom.
- **Server**: daemon and helper rows show their state as the row description with a status dot; button labels are
  short ("Start", "Stop", "Refresh") and never wrap; the command template is a stacked monospace field with a copy
  button.
- **Browser**: the bordered info boxes become row descriptions; origin lists are stacked rows.
- **Projects**: "Groups" becomes "Sections" in every visible string (the sidebar and its menus say "section"); keep
  the stored field names. Rewrite "Copies folder" and similar internal wording into plain words.
- **Appearance / Display & Sound / Composer / Features / Dictation / Git / Environments / Open in apps / Computer
  Use / Connectors / Engines / Codex flags / Import / About**: convert every control to the row recipe and the
  shared controls; split long pages into titled groups of related settings (3–7 rows each) in an order that puts the
  most used first.
- **About**: app name, version and update controls as a compact, centered-left header block followed by rows.

### Findings from the baseline review (two independent reviewers scored today's screens 4.8 and 6.1)

Their full reports are in `<repo root>/.tmp/settings-shots/r0-reviews.md`; read them. Beyond what is already
specified above, address these:

- **One home per concept.** "Default engine" appears on Engines and again on Models & Agents, which also has an
  "Engines" tab next to the top-level Engines section. Read the code first. If both controls write the same stored
  value, keep the control on Engines only and show a read-only summary row on Models & Agents with a "Manage
  engines" button (the section already receives a handler for that). If they are different values, give them
  distinct, truthful labels (for example "Engine for new threads" and "Engine for subagents"). If the "Engines" tab
  only repeats the Engines section, replace it with that same link; if it holds unique controls, move them to
  Engines. Codex flags stays reachable from the Codex engine row as well as from the navigation.
- **Say what a switch does.** Engine, provider and connector lists have a switch per row and nothing explains it.
  Find out from the code what turning one off does and say it once in the group description (for example "Engines
  that are on can be chosen when starting a thread."). Do the same for any other control whose effect is not
  obvious from its label: Queue vs Steer in Composer ("Queue: send after the current run", "Steer: redirect the
  run in progress"), Allowed and Blocked origins in Browser (who they constrain, what an empty list means, which
  list wins; take the answers from the code, do not guess).
- **Plain words first.** Descriptions lead with the consequence for the user. Implementation detail ("stay in the
  registry", "enforces every field", "in-process", "TCP transport path", notes about other operating systems) is
  cut, or shortened and moved after the plain sentence. Show only the note for the platform the app is running on.
  "(one per line)" moves out of labels into the description.
- **Off must not look disabled.** The off switch track needs a visible fill and edge against the card (about 3:1) in
  all three themes; disabled is a separate, dimmer state.
- **No content under a fade.** Remove the gradient that darkens the last rows of the content and of the navigation,
  or confine it to 12px, and give both enough bottom padding that the last row or item is fully visible. The search
  field stays pinned above the scrolling navigation list; the active item scrolls fully into view.
- **Server.** Two groups: "Connect to a remote server" (mode, host, token as separate labelled rows) and "Allow
  mobile connections" (daemon status with a dot, one Start or Stop button according to state plus a refresh icon
  button, the listening address stated as "Lets devices on your network connect"). A missing token is an amber
  callout beside the token row. Helpers that are unavailable collapse to one disabled row with the reason as its
  description. Do not change when actions are enabled unless they already depend on the state you show.
- **Composer.** Separate titled groups (Follow-ups, Responses, Presets, Code fences, and so on) instead of
  sub-headers inside one long card; one description for presets, not two saying the same thing; the indented hint
  switch becomes a normal row (disabled when it does not apply).
- **Shortcuts.** A full-width search field at the top of the page, not a settings row. Use the standard glyphs
  ⌃ ⌥ ⇧ ⌘ in the same order everywhere.
- **Providers.** Flat list rows like Engines: switch, then a "…" menu with Test, Edit and Delete (Delete in the
  danger style). One status vocabulary across Engines and Providers ("Ready", "Not tested", "Failed").
- **Projects.** A section's name is shown as text with a rename action (pencil icon, or click to edit in place) and
  is not a permanently open text field. Reorder controls show on hover or focus with a clear disabled state.
  "Copies folder" becomes "Folder for clones" with the path as text, "Choose…" and a clear icon button.
- **Appearance.** One "New theme" button plus a "…" menu for Import, Paste and Open themes folder. A theme that
  failed to load is a compact tile reading "Couldn't load theme" with the file name and reason in its tooltip and
  secondary line, not a red-bordered card.
- **Models & Agents.** "Save policy" becomes "Save changes" in the page header, with an "Unsaved changes" note
  beside it when there are any.

Things the reviewers said to keep: the Features screen's row pattern (it is the model for every section), the
Appearance theme grid with live previews and its selected state, the Engines list rows, the restrained palette and
type scale, and the search field in the navigation.

### Quality bar that applies everywhere

- Text never below 12px. Contrast: descriptions readable in the dark, dim and light themes.
- Nothing clipped or overlapping at the modal's default size and at its narrowest desktop width; the narrow
  (mobile master/detail) layout keeps working with rows stacking the control under the text.
- Left edges align: page title, group titles and card edges share one left edge; row labels share one inset.
- Focus rings on every interactive element; hover states on every clickable row or button.
- Respect `prefers-reduced-motion`.

## Files

- Modify: `src/features/design-system/components/settings/SettingsPrimitives.tsx` (and its test),
  `src/styles/settings.css` (consolidate: delete rules the new layout makes dead rather than stacking a third
  layer), `src/features/settings/components/**`, the embedded Evals and Diagnostics settings views only as far as
  header, width and controls go, `src/dev/uiPreview/**` only if a section needs better sample data to be judged.
- Create: small primitives you need (for example a keycap, a list row, a status dot, a callout) next to the existing
  primitives, with tests.
- Off-limits: `src/features/composer/`, `src/styles/composer.css`, `src/features/messages/`,
  `src/features/chat/ChatView.tsx`, `src/features/work/WorkView.tsx`, `src/services/dragDrop.ts`,
  `src/features/session/`, `src/features/app/components/Sidebar*`, `ThreadRow.tsx`, `WorkspaceCard.tsx`,
  `WorktreeCard.tsx`, `src/features/app/hooks/useSidebarMenus.ts`, `src/styles/sidebar.css`,
  `src/styles/ds-popover.css`, `src/features/design-system/components/menu/` (other work is in progress in all of
  these), the shared panel and button stylesheets (scope overrides under the Settings root instead), and all Rust.

## Constraints

- Follow the surrounding code and test style (vitest + Testing Library). No new dependencies. Icons from
  `lucide-react`.
- Accessible names of controls stay the same unless this spec renames the visible label; update tests that assert
  renamed labels or the navigation order, and do not delete tests to get to green.
- The repository is public: no personal names, home-directory paths, hostnames or project names from this machine in
  code, tests, comments or commit messages.
- Commit on the current branch in small commits with imperative subject lines. Do not push.

## Verification

Run from `apps/nucode/` until all pass:

```
npm run typecheck
npx eslint src --ext .ts,.tsx
npx vitest run --testTimeout=30000
```

Look at your work. A UI preview of this worktree is already running at `http://localhost:1421` (do not start a
second one on that port; if it does not answer, run `npx vite --mode uipreview --port 1441 --strictPort` and pass
1441 below). Capture every section with the script already placed in the worktree:

```
node <repo root>/.tmp/settings-shots/capture.mjs <repo root>/.tmp/settings-shots/<round> 1421
node <repo root>/.tmp/settings-shots/capture.mjs <repo root>/.tmp/settings-shots/<round>-light 1421 light
```

It uses Playwright WebKit (the app runs in WKWebView) at 1360×860 and writes one PNG per section, plus a `-b` PNG
for sections longer than one screen. Open the PNGs and judge them against this spec and against
`.tmp/settings-shots/rubric.md` (the rubric the reviewers use). The baseline captures are in
`.tmp/settings-shots/r0/`. Do at least two full capture-and-fix passes over all sections in the dark theme and one
in the light theme before reporting; in each pass write down what still looks off and fix it. Typical misses:
a section that kept its old layout, a control wider than 260px in a normal row, a description under a control, two
different input fills on one page, uneven gaps between groups, a button label that wraps, an unreadable disabled
state, light-theme borders that vanish.

## Out of scope

Changing what any setting does, adding or removing settings, the app outside the Settings modal, and everything in
the off-limits list.

## Report

What you changed, decisions this spec did not settle, anything you could not do, which capture folders hold your
final dark and light screenshots, the list of problems you still see, and the final output of the three
verification commands.
