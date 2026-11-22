# Changelog

## Unreleased

- **Script cells stopped mid browser call:** an omp eval cell that calls the in-app browser or Computer Use without its own timeout now gets 3 minutes (10 minutes with Computer Use) instead of 30 s. The browser call inside alone could take most of the 30 s, so the cell was stopped with the call still running and the kernel's state was lost. A timeout the agent sets is kept.
- **Browser tools that ran into the 30 s timeout:** every in-app browser tool now answers within 25 s. A call that runs out of time says so and what to check next, instead of the agent getting "Request timeout after 30000ms" with no idea what happened. A navigation that already landed stays a success when the page snapshot after it isn't ready in time. Browser calls sent together run side by side, so a slow one no longer holds back the calls behind it past their own timeout.
- **In-app browser stuck after a link to a section of the same page:** opening a URL that differs from the current page only after the # (for example `#market` to `#settings` in a one-page app) no longer leaves the page marked as loading for good. The agent's browser_navigate used to hang until the 30 s tool timeout, and every snapshot, screenshot or click after it waited for a load that never came.
- **Role effort:** each agent role can have its own reasoning effort in the team editor and in Settings → Models & Agents → Roles, so a commander on Medium can run its team on High. A role without one uses the effort of the agent that delegates to it.
- **Chain of Command:** the composer's model chip shows a star while a team is on, and the team editor is large enough to show five roles with their models.
- **Agents opening the same pictures over and over:** an agent that keeps re-opening the same screenshots is now stopped even when it copies them to new folders or another format first. With a model reached through an OpenAI-format proxy, an agent can open at most two images per step: the proxy passes on only the last two, so a third is refused with that reason instead of arriving as text and being opened again.
- **Agents ending early:** an agent in a team no longer ends its run while a command it started in the background is still going (for example "waiting for the screenshots to finish", and then nothing). Agents now run their commands to the end before they reply, including ones that take longer than a minute, such as a full test suite.
- **Review reports:** a reviewer's report is no longer thrown away because it retyped a long acceptance criterion with different line breaks or spacing. A criterion can also be named by its number. A refused report now lists the criteria the reviewer was given (for example when it split them into more checks), or names the file to leave out, so the reviewer can correct it in one try.
- **Review:** a team turn that finishes its work no longer ends as a failed turn with "Review needs follow-up" when QA could not confirm a check. The turn completes, and a review card says how many checks were confirmed, names the ones that were not with QA's note, and offers "Check again with QA". A passed review shows as "Review passed". Turns that only read, search, use read-only roles or run commands that leave the project's files as they were no longer get a review status at all; before, any tool use in a team turn without a QA major ended it as failed. The card appears once, when the turn ends: a run that pauses for a background job and resumes no longer shows "Not reviewed" while it is still working. A review also stands through what cannot have undone it: a command after QA that changes no file (a status check, stopping a preview), and a run that resumes by itself after a background job. Before, either one ended the turn as "Not reviewed" although QA had run.
- **Agents:** a running agent shows what its latest step is doing and how many steps it has taken, in the Agents panel and on its row in the conversation ("designer · Viewing the alerts screen (step 12)"). Before, a delegation that ran for half an hour showed only a timer and a token count, so a working team looked stalled.
- **Agents going in circles:** an agent whose last 36 steps all repeat steps it has already made three or more times is told so in place of the next repeat, and asked to finish from what it has. A child agent that is told twice and still goes on loses its tools and has to report, so its parent is no longer left waiting on a run that will not end. Steps that differ only by a counter or an image format count as the same step; an edit with new text never counts as a repeat.
- **Long agent runs:** a Claude agent reached through a proxy no longer stops with a content filter error at the moment its history is first shortened to make room, and then again on every retry. The engine archives the older turns, the model's reasoning included, and sends the middle of a long archive as pictures of the text; Claude refuses a request that shows its reasoning back to it, as text or in a picture. nucode now takes the reasoning out of the turns before they are archived, and out of the text of archives made earlier. The archive's key to its labels no longer mentions the model's reasoning either: with that line alone, Claude refused a shortened history as soon as another message followed it, such as a finished background job's result.
- **Cut-off answers:** when a provider cuts an agent's answer off part-way (a content filter stop), the agent no longer fails and loses everything it did. It goes on from where it was, with its whole history, and is asked to write long results in smaller parts. This is tried twice; after that the agent ends with the provider's reason.
- **Context after a restart:** opening a conversation after the app restarts (or after a new build) shows its context usage straight away, taken from the saved conversation. Before, the Context section read "Usage not reported yet" until the next turn finished.
- **Model of a reopened conversation:** a conversation run on the OMP engine keeps its own model when it is opened after a restart. The engine records model changes in a different form from Pi, and reading it blanked the conversation's model, so the context capacity read "unknown" and the model had to be worked out again.
- **Approvals:** in a conversation with Full access, the approval for the engine's code-running tool (eval) now offers "Allow for session". One answer then covers that tool for the rest of the conversation, so a long turn no longer waits on the same question again and again. Other access modes and other tools ask each time, as before.
- **Send:** a message that cannot be sent because the conversation could not be started (the engine would not start) is no longer dropped without a word. A notice says why and the text goes back into the composer.
- **File links:** a path far outside the project is shown whole (`/tmp/notes/brief.md`) instead of as a climb to the root (`../../../tmp/notes/brief.md`). Nearby folders keep the short form.
- **Agent limit:** when a team turn runs out of agents, the conversation says how many it could not start and offers a higher per-turn limit in one click, sized for those agents plus a fix and a second check. The last agent a turn may start is now kept for a major, so the work can still be verified. The Agents view and the sub-agent row say "not started" for such an agent, with the reason, instead of an internal error.
- **Agents view:** once a conversation has started sub-agents, the title bar shows an Agents toggle that opens the tree of the team, with each agent's model, time and token use, and it stays after the run ends. Before, that view could only be opened from the browser pane's new tab. Previews of an agent's task and report no longer show Markdown marks. Run times read as minutes and seconds, and token counts as thousands or millions.
- **Sub-agents:** an expanded sub-agent row names each agent by role and number with its model, such as "Researcher 2: completed · Claude Haiku 5.5", instead of internal ids. The task and the agent's report read as formatted text instead of a raw code block, each agent's result is listed once, file paths in it keep their folder separator, and a call that started only some of its agents reads "Spawned 2 of 4" instead of "Spawn failed".
- **Context size:** `/context-size` and `/autocompact` take effect at once when sent during a running turn instead of waiting in the queue. Settings → Providers has a Context window field for each model, and each model's options fold into one row.
- **Project team:** saving a team for a project from the composer no longer copies the app's default engine and model onto the project, so the project keeps following the app when those change.
- **Agent tools:** `npm` and `npx` work in agent commands. They failed with a missing-module error, so agents fell back to whatever Node was installed on the Mac.
- **Composer:** reopening a conversation whose last turn ended with "Review needs follow-up", "Agent stopped unexpectedly" or "Interrupted when nucode closed" no longer puts the whole earlier request back in the composer. Those turns ask for a follow-up, not a resend.
- **Session panel:** with Git turned off in Settings → Features, the Environment section leaves the branch row out instead of saying "No Git branch" for a folder that has one.

## 0.8.2 — November 13, 2026

- **Settings:** every Settings page has a new layout: named groups, plain labels with one line of help, collapsed rows that show their current value, and a Save changes button on the pages that stage edits. Server, Browser, Models & Agents, Shortcuts and Projects were reorganized around what you are trying to do.
- **Attachments:** drag files from your file manager onto the composer to attach them. Images show as thumbnails above the message box instead of file names.
- **Scrolling:** you can scroll up through a conversation while a reply is being written. The view follows new text only when you are at the bottom.
- **Project menu:** right-click a project for Pin, Edit, Section, Reveal in Finder, Archive chats and Remove project. Remove project deletes the project's chats, checkpoints and engine data from nucode, and says so; the folder and its files stay on disk. Sections group projects in the sidebar under names you choose. Right-click a section's header to rename or delete it.
- **Thread menu:** right-click a thread for Rename, Pin, Mark as unread, Project, Section, Fork, Share, Copy, Open in new window, Archive and Permanently delete. Rename, Pin, Mark as unread and Archive have shortcuts you can change in Settings → Shortcuts. Moving a thread to another project and deleting it permanently work for pi and omp threads. The Copy items show a short notice naming what was copied, and Fork into a new worktree is left out when worktrees are turned off in Settings.
- **Thread windows:** Open in new window shows one thread in its own window, with its transcript and composer. It closes when the thread is archived or deleted and follows the thread when it moves.
- **Closed windows:** a closed thread, About or browser sign-in window is freed. Before, each one stayed behind as an invisible window until nucode quit.
- **Long titles:** a project or thread title too long for the sidebar scrolls to its end when you point at it.
- **Session rail:** the Context row at the top is gone. The Context section already shows how full the window is.
- **Dictation:** a keyboard shortcut that begins with the hold-to-talk key no longer starts a recording.
- **Dialogs:** the window behind a dialog is dimmed instead of blacked out.
- **Right-click:** an area with no menu of its own no longer shows the web view's Reload menu. Fields, links, pictures, the terminal and selected text keep theirs.
- **Keychain prompt:** when macOS asks for your keychain password before a pi or omp engine can start, as it can after a newly installed build, the conversation shows "Waiting for macOS keychain access…" instead of "Working…", and other threads and the session rail keep responding while the dialog is open.
- **Model switching:** a thread that switched to a Claude model after another model had reasoned in it could fail on every turn with a content-filter stop. The earlier model's reasoning is no longer replayed to the new model; its answers and tool results still are.

### Release status

Published as a macOS Apple Silicon release, with a DMG installer, build manifest and SHA-256 checksums. Windows remains on 0.8.0. This remains an early-development release; the macOS package is development-signed and not notarized.

## 0.8.1 — November 11, 2026

- **Layout fix:** a checkpoint warning could push the whole window down, hiding the composer buttons and Settings behind an empty box at the top that could not be closed. The warning now floats under the title bar with a working Dismiss button.
- **Response style:** Settings → Composer has a Response style: Concise, Standard (the new default) or In depth. Standard and In depth tell pi and omp agents to keep working until the request is handled, check their work and write as much as the work needs, in place of pi's built-in "be concise" rule.
- **Steer queued messages:** during a running turn, hover a queued message and choose Steer to send it into that turn right away. The row's menu has Steer now too.
- **Context:** the session rail shows what fills the context window and how far it is from auto-compact, with a Compact session button. `/context-size` sets the window nucode assumes for the current model, and `/autocompact` sets when pi and omp compact.
- **Web search:** agents have background `web_search` and `web_fetch` tools that work without opening the browser pane. Search goes through the provider chosen in Settings → Browser, SearXNG first.
- **Dictation:** transcription runs on Metal, Cancel stops it, and it says when it hears nothing. The voice wave shows in Chat and Work.
- **Errors:** a reply the provider stops with a content filter says so, as does a model your proxy has paused for a cooldown. Stopping an engine on purpose is no longer logged as a crash, and only the selected provider's key is required.
- **Title bar:** the session rail toggle is a list icon at the start of the pane toggles, and the browser toggle is the panel icon at the end. Log has its own icon and Run names the launch script.

### Release status

Published as a macOS Apple Silicon release, with a DMG installer, build manifest and SHA-256 checksums. Windows remains on 0.8.0. This remains an early-development release; the macOS package is development-signed and not notarized.

## 0.8.0 — November 9, 2026

- **New name:** the app is now called nucode, with bundle identifier `dev.nucode.desktop` and a new GitHub home at [aiden0rchad/nucode](https://github.com/aiden0rchad/nucode).
- **Packaging:** release bundles no longer contain Python cache files, and bundle checks reject embedded builder home paths.
- **Chat:** with steering on, a message sent while a reply runs stops that reply and is answered straight away, instead of waiting for the whole reply to finish.
- **Work Trash:** deleting a task moves it to Trash, where it can be restored for 30 days.
- **Work composer:** a message waiting for the model shows in the task's transcript instead of staying in the message box, and returns to the box if you stop the launch.

Releases before 0.8.0 were published under the project's earlier name. Their downloads are no longer available; the notes below are kept as history.

## 0.7.71 — November 2, 2026

### Faster Computer Use and steadier Work tasks

- **Computer Use speed:** targets that match one on-screen label exactly skip the grounding model, and runs of clicks on buttons that stay on screen are planned once. A Calculator run went from 73 to 17 seconds.
- **Notes and Reminders:** search them through their scripting interface instead of their search fields, without using the window. macOS asks once per app whether nucode may control it.
- **Typing:** keyboard steps wait for you to stop typing instead of failing, so your keystrokes cannot land in the target app.
- **Reliability:** runs whose action closes an app's last window can still finish, and a briefly unreadable control is re-read instead of cancelling the step.
- **Work follow-ups:** queue follow-ups while a task runs. They are kept with the task, survive switching modes and restarting the app, and are sent one at a time after each finished turn.
- **Work tasks:** delete finished, stopped or queued tasks from the task menu (files stay in the space). Task menus now open above the main pane, and the sidebar tree line no longer runs through group headings.
- **Chat:** Chat no longer queues follow-ups. With steering on, a message sent while a reply runs is added to that reply.
- **Interruptions:** a task cut off by the app quitting says so, instead of suggesting another model.
- **Window:** the window keeps its size and position across restarts, including after a forced quit, on mixed-resolution displays.
- **Usage:** an all-time usage ledger survives transcript removal.

### Release status

Published as a macOS Apple Silicon release, with a DMG installer, build manifest and SHA-256 checksums. Windows remains on 0.7.69. This remains an early-development release; the macOS package is development-signed and not notarized.

## 0.7.70 — November 1, 2026

### A more cohesive desktop interface

- **Typography:** use Codex Desktop's system-font stack across the interface and chat, with lighter macOS text smoothing. Existing default settings update automatically; custom fonts and monospace code remain intact.
- **Projects:** restore squircle project cards with room around their contents, tighter chat rows and clearer selection.
- **Session rail:** dock beside wide chats and float over narrower chats from one toolbar toggle. Share the conversation's gradient and translucency, use the full available height, and simplify section headers and reordering controls.
- **Scrolling and resizing:** quieter chat scrollbars, no visible rail scrollbar, and less work during sidebar and pane resizing. Preserve mounted panes and drafts while moving dividers.
- **Window and settings:** improve window-size restoration and titlebar spacing at reduced UI scales; add settings search and consistent dialog and feedback layouts.
- **Roles:** use the current project for role editing and remove the redundant global custom-agent editor. Existing global definitions remain unchanged.
- **Updates:** download the compatible GitHub release installer inside nucode, with progress, retry, size verification and SHA-256 verification when GitHub provides a digest. Open the completed installer through the operating system; installation remains manual.

### Release status

Published as a macOS Apple Silicon release, with a DMG installer, build manifest and SHA-256 checksums. Windows remains on 0.7.69. This remains an early-development release; the macOS package is development-signed and not notarized.

## 0.7.69 — November 1, 2026

### Desktop reliability and clearer controls

- **Computer Use:** improved app targeting, focus recovery, typing into rebuilt fields, and progress and approval controls. Automatic execution without per-action approvals is now the default; approval mode remains configurable.
- **Chat:** queue or steer follow-ups while a response is running, with improved conversation history, images and titles.
- **Browser:** recover failed navigation and browser creation, restore tabs more reliably, and keep loading and recovery states clear.
- **Tasks and services:** clearer OMP service history, task progress and app-quit stop states.
- **Settings:** keep Codex roles scoped to their project and preserve exact role names and other settings values on macOS.
- **Updates and support:** check GitHub for new releases and prepare editable issue reports with redacted diagnostics.
- **Documentation:** expanded onboarding, installation steps, first-task tutorials and platform guidance.

### Downloads

| Platform | Package |
| --- | --- |
| macOS · Apple Silicon | `nucode_0.7.69_aarch64.dmg` |
| Windows · Intel/AMD 64-bit | `nucode_0.7.69_x64-setup.exe` |
| Integrity | `SHA256SUMS` |

Packages include Node, npm, uv and the app's helper executables. The macOS build manifest records exact bundled runtime versions and the DMG checksum. Source archives are available on the release page.

### Before installing

This is an **early-development release**, with no stable-release or cross-platform feature-parity guarantee. The macOS package is development-signed and **not notarized**; the Windows installer is **unsigned**. Native Computer Use has the broadest verification on macOS. Intel Mac, Linux and iOS installers are not included.

Read [Installation & first run](docs/getting-started.md) and [Builds & platform status](docs/releases.md). Keep your existing app data when updating. Downloads are installed manually; nucode does not replace itself.

### Earlier builds

- [October 30 desktop test build](https://github.com/aiden0rchad/nucode/releases/tag/build-2026-10-30-b6848c7)
- [Initial Windows x64 test build](https://github.com/aiden0rchad/nucode/releases/tag/windows-x64-v0.7.68)
