# M33 round 3: Settings redesign, clarity and finish

All paths are relative to `apps/nucode/` unless they start with `docs/`. This continues
`docs/specs/m33-settings-redesign.md` and `m33-settings-redesign-round2.md`; everything there still applies (goal,
off-limits list, constraints, the behaviour rule, verification commands).

Round 2 scored 7.8 and 7.9 from one reviewer and 7.9 twice from the other; the target is 8 or more from both. Both
now say the grid is right (one column, one control width, one row recipe). What is left is clarity and state
details. Their four reports are in `<repo root>/.tmp/settings-shots/r2-reviews.md` and the screenshots they judged
are in `<repo root>/.tmp/settings-shots/r2/` — read both before starting.

The branch was rebased onto `main` since your last commit, so the hashes changed, and one commit was added on top:
the shared shortcut formatter (`src/utils/shortcuts.ts`) now writes macOS modifiers in the ⌃ ⌥ ⇧ ⌘ order itself, the
Shortcuts section uses it directly, and Rename, Pin, Mark as unread and Archive sit in a new "Threads" group. Do not
bring back a local re-ordering helper.

## The behaviour rule, restated

No setting changes its stored key, values, default or handler. This round moves, relabels, hides and explains
controls; it adds no new stored setting. Where a row is shown only in one state, the value it edits must still be
reachable in every state where the code uses it. Check the code before you write a sentence that states what a
setting does, and say in the report what you found.

## System-wide

1. **One disclosure recipe.** Add one primitive (for example `SettingsDisclosureRow`) and use it for every
   expandable row in Settings: it is a row inside a card, the chevron starts at the row inset (the same x as row
   labels, 481 at 1360px wide), the label starts 16px after the chevron's left edge, an optional muted summary sits
   at the right, dividers run the full card width like every other row, and the expanded content is inset under the
   label. Convert: both disclosures on Models & Agents, the three "agent policy" rows on Projects, "Details" on
   Computer Use, and any other chevron or `<details>` in Settings. No disclosure floats outside a card.
2. **One secondary button.** "Test", "Reset all…", "Choose folder…", "Generate", "Check again", "Manage engines" and
   every other non-primary text button use the same bordered secondary style with full-strength text. No bare-text
   action and no grey filled variant.
3. **One disabled recipe.** A disabled control is the normal control at about 45% opacity with a `not-allowed`
   cursor and a `title` that gives the reason; a disabled primary button loses its accent fill (neutral fill), so it
   cannot be read as a second colour. When a row is disabled its label, description and control dim together.
4. **Descriptions are one line** wherever the wording allows and never more than two. Move the rest into the
   disclosure or drop it. Today's three-line ones: "How agents work", "Agent browser permissions", the Browser
   "Engine" row; two lines with an inline shortcut: "Follow-up behavior".
5. **Shortcuts inside descriptions are keycaps** (`SettingsKeycaps`, fed by `formatShortcut`), not words like
   "Shift+Cmd+Enter".
6. **Saving is stated once.** In the modal's header bar, right-aligned before the close button, a muted 12px line:
   "Changes save automatically". When the stored app settings change while Settings is open it reads "Saved" with a
   check for about 1.5s, then returns. On the pages that stage edits (the ones using `SettingsUnsaved`) the line is
   hidden, because those pages show "Unsaved changes · Discard · Save changes" themselves. Keep the list of staged
   pages in one place.
7. **Navigation.** A group label must never be cut in half under the search field (it still is on Server, where the
   list is scrolled). Put a hairline under the search field and fade the top 12px of the list while it is scrolled.
8. **Meta lines** have even gaps around every "·" (Engines shows a wider gap before the last items).

## Per section

- **Models & Agents.**
  - One intro line, replacing the page description and the scope paragraph: "Models, subagents and roles for new
    threads. A project can override them in Projects."
  - Under the Defaults tab the card has no group title and no group description (the tab already says "Defaults").
  - "How agents work": the three options are named by outcome, not mechanism. Read what `single`,
    `chain-of-command` and `custom` do and name them accordingly (for example "One model", "Chain of command",
    "Delegate to your roles"); the description is one line for the selected option. The note about Chat and Work
    moves into the engine disclosure.
  - Both disclosures live in one card titled "Details": "What each engine supports", and "Settings in effect for
    <project>" with the summary "App defaults + project overrides" and a read-only body. Say "project", never
    "workspace", in Settings copy.
- **Projects.**
  - "Project placement" becomes a flat list: remove the in-card "Studio" / "No section" sub-headers (the select on
    each row already says it); order stays section order, then project order. Description: "Each project's section
    in the sidebar. Use ⋯ to move a project up or down within its section, or to remove it from nucode."
  - Section rows: the button reads "Choose folder…"; Rename moves into the row's ⋯ menu (first item) and starts the
    same inline edit; the standalone pencil goes away.
  - "Project overrides" uses the disclosure recipe.
- **Server** (desktop layout; the mobile-simplified branch only picks up the shared recipes). Read first and
  report: (a) in Local mode, is the Host value used for anything but its port? (`tailscale/mod.rs` builds the listen
  address as `0.0.0.0:<port>`); (b) what "Use host" writes and whether anything but the Host field depends on it;
  (c) that phone access and Remote mode read the same stored token. Then, assuming the code agrees:
  - Group "Where nucode runs": row "Backend mode" with a one-line description of the selected option. When Remote is
    selected the same card gains "Server address" (the Host field: "The computer to connect to, as host:port.") and
    "Server token" (the Token field, no Generate, placeholder "Paste the server's token").
  - Group "Phone access", description "Let the nucode mobile app connect to this computer.":
    - "Status": the Stopped/Running pill after the label; description "Set an access token to start", "Listening on
      port <port>" or the error; refresh icon (title "Refresh status") and one Start or Stop button.
    - In Local mode, "Access token": a stacked full-width monospace field (a token is long) with a "Generate"
      secondary button on the field's line, placeholder "Paste or generate a token", description "Your phone signs
      in with this token." The missing-token callout sits under it, once.
    - In Local mode, "Listening address" (the Host field), description stating what (a) found, for example "Only the
      port is used: this computer listens on it on every network interface."
    - In Remote mode, in place of those two rows, one plain row: "Phone access uses the server token and port set
      above."
    - "Phone connects to": the Tailscale suggested address as a monospace value with a Copy icon button; description
      "Enter this address and the access token in the mobile app." Without a suggestion, no value and a description
      that says how to get one.
    - "Tailscale": a status line in the list-row recipe ("Running · v1.76.6 · <tailnet>") and "Check again"
      (today's "Detect"). Drop "Use host" only if (b) shows it does nothing but rewrite the Host field; otherwise
      keep it with a label that says what it changes.
    - "Keep running after the app closes" (switch): "After you start phone access, keep it running when nucode
      quits."
    - "Start by hand": the stacked command field.
  - "Mobile access" becomes "Phone access" in Settings copy; no group title repeats its first row's label.
- **Browser.**
  - "Engine and search" card order: Engine; Browser binary only while Headless Chromium is selected (a stacked row
    directly under Engine; hidden under Native, where round 2 found it is ignored); "Web search provider" with
    options "None" and "SearXNG"; Search URL last, the only stacked field under Native.
  - Group "Access" directly after it, holding (1) the approval select, titled "Agent actions", with a one-line
    description of what agents do without asking and what the setting covers; check whether agent tabs share your
    signed-in profile and, if they do, say "including sites you are signed in to"; (2) a disclosure row "Site
    rules" whose summary reads "All sites allowed" or "<n> allowed · <m> blocked" and whose body is the two origin
    fields (moved here from their own group).
  - Then "Privacy and sign-ins", then the password groups.
- **Composer.**
  - "Response style": read what each value changes; the description is one line that states the selected value's
    effect (not a general sentence about the setting). If the three values only change length, say so and drop the
    part about how far agents carry a task; if they change both, name both.
  - "Follow-up behavior": one line with the shortcut as keycaps.
- **Engines and Providers.** "Test" is the standard secondary button.
- **Shortcuts.** "Reset all…" is the standard secondary button, disabled (recipe 3, title "Every shortcut is at its
  default") only when nothing differs. In the UI preview's mock settings give one shortcut a non-default value so
  the preview shows a changed row with its reset icon.
- **Appearance.** Theme tiles have a single footer line: the name, and at the right of the same line a small muted
  tag only where it says something ("Auto" on System, "Custom" on themes the user made). No second line on any
  tile. The header "⋯" ends at the column's right edge and is vertically centred on "New theme".

## Measure, then read every final screenshot

Extend `.tmp/settings-shots/measure.mjs` to also print, per section: every disclosure's chevron x and label x
(must be identical everywhere), and every secondary button's computed border and text colour (must be identical).
The table goes in the report.

Capture with `capture.mjs` as before (rounds y1, y2, … and y1-light, …; the third argument is the theme). The last
dark pass and the last light pass must be captured after your final commit, and you must open and read every PNG of
both, including the `-b` files. Last round the final sets were not re-read; do not report until they are. The
reviewers judge the top of these ten pages at 1360×860 in dark: Appearance, Features, Engines, Providers, Models &
Agents, Composer, Shortcuts, Projects, Browser, Server — look at those exactly as a stranger would and fix whatever
makes you stop and decode.

## Verification, report

The three commands from `apps/nucode/`. Add or update tests for what you change (Server rows per mode, Browser
binary hidden under Native, the site-rules summary, the saving line, the disclosure primitive, the disabled "Reset
all…"). Commit in small commits with imperative subjects; do not push. Report: what changed, what the code said for
(a), (b), (c) and for each sentence you wrote about a setting's effect, decisions this spec did not settle,
anything not done or not verified, the measurement table, the final capture folders, the output of the three
commands, and commit hashes copied from `git log`.
