# M33 round 2: Settings redesign corrections

All paths are relative to `apps/nucode/` unless they start with `docs/`. This continues
`docs/specs/m33-settings-redesign.md`; everything there still applies (goal, files, off-limits list, constraints,
verification commands). Round 1 scored 7.1 and 7.4 out of 10 from the two reviewers (from 4.8 and 6.1). The
structure is right; what is left is finish and clarity. Their full round 1 reports are in
`<repo root>/.tmp/settings-shots/r1-reviews.md` and the screenshots they judged are in
`<repo root>/.tmp/settings-shots/r1/` (dark) — read both before starting.

## The behaviour rule, restated for this round

No setting changes its stored key, values, default or handler. Three small additions are allowed because they only
call existing setters: "Reset all" for shortcuts, "Generate" for the server token, and "Discard" for unsaved
agent-policy edits. A control may be shown disabled only where the code confirms that using it would fail or be
ignored in that state; check before you gate, and say in the report what you found for each gate.

## System-wide

1. **One control width.** In a normal row every select and every single-line text input is exactly 220px wide, so
   their left edges line up down a page and across pages. Options longer than that truncate with an ellipsis. The
   only exceptions: number-like fields (a percentage, a count, a size) are 96px; anything that holds a URL, a path,
   a command, a font stack or other long text is a stacked full-width field under its label. No other widths.
2. **The column must not move.** The content column shifts 4px between pages that scroll and pages that do not
   (title at x=464 on some, 468 on others at 1360px wide). Reserve the scrollbar space always (for example
   `scrollbar-gutter: stable` on the scrolling pane, or an equivalent that works in WebKit) so title, cards and the
   control edge are at identical x on every section.
3. **Rows need their dividers.** The 1px lines between rows inside a card are missing or invisible in the dark, dim
   and light themes. Make them visible (about 8% of the text color over the card works in all three) without
   becoming heavy.
4. **One vertical alignment.** Controls are vertically centered in their row everywhere (the Queue/Steer control
   on Composer is pinned to the top of its row).
5. **One input font rule.** Values that are hosts, ports, paths, commands or origins are monospace; every other
   value and every placeholder is the interface font.
6. **Page descriptions** use the full column width and fit on one line where the wording allows; none may leave a
   single word on a second line (Server, Engines do today).
7. **Group headers.** An "Add …" button sits on the group-header line, right-aligned, on every page that has one
   (Appearance keeps its page-header position because the gallery has no group). A group description never appears
   without a group title. A card that would hold a single row is merged with a neighbour, and a group title never
   just repeats its only row's label or the page title.
8. **One separator** in meta lines: "Ready · v1.4.0 · pi-RPC", "Not tested · openai · Default endpoint · 6 models".
9. **Light theme:** the off switch has a white knob on a grey track (it is a dark knob today).
10. **Labels do not repeat in their own button.** A row called "Run setup" has a button "Open" or "Run", not
    "Run setup" again; apply this wherever a row label and its button text are identical.
11. **Save pattern for the pages that stage edits** (Models & Agents, Computer Use, Environments, and any other
    page with an explicit save): nothing in the header while there is nothing to save; when there are unsaved
    edits the header shows "Unsaved changes", a ghost "Discard" and a primary "Save changes". Same wording and
    placement on each of these pages. Under each such page's title add nothing else about saving. If a page has no
    way to know whether it is dirty, give it one (compare the draft with the stored value) rather than leaving an
    always-enabled button.

## Per section

- **Shortcuts.** Modifier order is the macOS one, with the key last: ⌃ ⌥ ⇧ ⌘ (so ⇧⌘N, ⌥⌘N, ⌃⌘A), in keycaps and
  in tooltips; other platforms keep their conventional order. Add "Reset all…" (secondary, with a confirmation) on
  the same line as the search field. The per-row reset icon is always visible on a row whose value differs from
  its default. The binding button needs a clearer outline at rest and an unmistakable recording state (accent
  ring, "Press keys…").
- **Projects.**
  - Every project row shows a section select (220px, the sections plus "No section") and a "…" menu with "Move
    up", "Move down" and "Remove from nucode…" (danger; keep the existing confirmation). No bare trash icon. The
    group description must describe what is actually on screen.
  - "Ungrouped" reads "No section" everywhere in Settings.
  - "+ Add section" is a secondary button on the Sections group-header line; clicking it reveals an inline row
    with the name field, "Add" and "Cancel".
  - A section row: name with the rename pencil; description "Clones go to <path>" or "Clones go to the default
    folder"; on the right "Choose…" then a "…" menu with "Use the default folder" (when a folder is set) and
    "Delete section" (danger).
  - The per-project agent policy group is titled "Project overrides", its description says these override the app
    defaults from Models & Agents for one project, and each disclosure's chevron starts at the row inset like
    every other row.
- **Models & Agents.**
  - A scope line directly under the page description: "App defaults. They apply to new threads in every project;
    a project can override them in Projects."
  - "Working mode" and its single "Agent mode" row become one row, "How agents work", whose description explains
    the option that is currently selected (one sentence per option, written from what the code does). Notes about
    which engine supports what move into a "What each engine supports" disclosure at the bottom. Engine names are
    written the way the Engines page writes them.
  - No card holds a single row.
- **Server.** Read the code first: does starting mobile access without a token fail, or start an unusable or
  unprotected daemon? Then:
  - Group "Connection details": Host and Token, with the description "Used when this app connects to a remote
    server and when your phone connects to this computer." Token has a "Generate" secondary button that fills in
    a random token through the existing commit handler. The missing-token callout appears here once and nowhere
    else (remove the red duplicate above the command field).
  - Group "This app": Backend mode, with a description that explains the selected option.
  - Group "Mobile access": the row reads "Mobile access" with its status as a pill right after the label
    ("Stopped", "Running"), a one-line description, then the refresh icon and one Start or Stop button. If the code
    confirms that a token is needed, Start is disabled until one is set, with "Set a token to start" as the row
    description; if it is not needed, word the callout truthfully instead of saying "required". "Keep running
    after the app closes" stays a switch row. A helper that is unavailable is one disabled row whose button is
    also disabled. The command is a stacked monospace field with its copy button aligned to the field.
  - The UI preview's mock returns "Unavailable in browser preview" for the helper; change the mock
    (`src/dev/uiPreview/`) to return a realistic state so the preview shows what the app shows.
- **Browser.**
  - The first group is "Engine and search" (not "Browser" again).
  - Search URL is a stacked full-width field so the whole template is readable. The note about downloads leaves
    that row: make it its own read-only row if it describes real behaviour, otherwise drop it.
  - Browser binary is disabled while the engine that does not use it is selected (verify in the code that the
    value is ignored then), keeping its description.
  - Private browsing becomes a switch if it has exactly two states in the code; otherwise it stays a select.
  - The approval setting is labelled "Agent browser permissions" and says plainly what agents may do without
    asking and what this setting covers (verify against the code that decides it).
- **Composer.** Two groups instead of four: "Conversation" (Follow-up behavior, the hint switch, Response style)
  and "Editor helpers" (Preset as the first row, then the fence and list switches it sets). Keep one preset
  description.
- **Engines and Providers.** A row whose status is "Not tested" or "Failed" shows a ghost "Test" button before the
  switch that runs the same action as the menu's test item and updates the status; rows that are "Ready" do not.
  Providers gets a group title ("Your providers") with a one-line description.
- **Appearance.** Theme tiles have no empty second label line: either every tile has a one-line descriptor or none
  reserves the space.
- **Computer Use.** The runtime row says "Ready" once. The long "Typing confirmation" description becomes two
  lines at most, with the full rule behind a "Details" disclosure or tooltip.
- **About.** The version appears once in the header block; the Build group does not repeat it.
- **Navigation.** When the list is scrolled, a group label must not sit half-cut under the search field: give the
  list a little top padding inside its scroller, or snap, so an item or label is either visible or not.

## Measure, do not eyeball

Before each capture pass, run a small Playwright WebKit script (keep it under `.tmp/settings-shots/`, not in the
repository) that opens every section at 1360×860 and prints: the page title's left x, the first card's left and
right x, and for every select and text input in a normal row its width and right x. The pass is not done until
every section prints the same title x and card edges, and every normal-row control is 220px (or 96px for the
number-like ones) ending at the same right x. Put the final table in your report.

Then capture as before (`capture.mjs`, dark and light; the script's third argument is passed to the preview as
`?theme=`), read the PNGs, and fix what is off. At least two full passes in dark and one in light, and read every
light PNG this time, not a sample. Name the rounds x1, x2, … and x1-light, ….

## Verification, report

As in the round 1 spec: the three commands from `apps/nucode/`, then the report (what changed, what the code said
for each gate you added or declined to add, decisions, anything not done or not verified, the measurement table,
the final capture folders, and the output of the three commands). Commit hashes copied from `git log`.
