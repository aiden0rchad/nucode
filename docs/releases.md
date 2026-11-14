# Builds & platform status

nucode is in **early development**. The source is available for inspection and building; published test artifacts are experimental. A package version or a passing build is not a stable-release or feature-parity guarantee.

The source version is **0.8.2**, prepared on **November 13, 2026**. Its changes are in the [changelog](https://github.com/aiden0rchad/nucode/blob/main/CHANGELOG.md). The [v0.8.2 release](https://github.com/aiden0rchad/nucode/releases/tag/v0.8.2) is a macOS-only release; the [v0.8.0 release](https://github.com/aiden0rchad/nucode/releases/tag/v0.8.0), the first under the nucode name, has the current Windows package. See [GitHub Releases](https://github.com/aiden0rchad/nucode/releases) for the assets actually published and the commit behind each build.

## Installable artifacts

The [v0.8.2 release](https://github.com/aiden0rchad/nucode/releases/tag/v0.8.2) provides the macOS package and the [v0.8.0 release](https://github.com/aiden0rchad/nucode/releases/tag/v0.8.0) the Windows package. For step-by-step installation and help choosing a file, use [Installation & first run](getting-started.md#_1-install-the-app).

### Windows x64 test build

The [v0.8.0 release](https://github.com/aiden0rchad/nucode/releases/tag/v0.8.0) contains:

- `nucode_0.8.0_x64-setup.exe`
- `SHA256SUMS`

It is an **unsigned early-development build** for 64-bit Intel/AMD Windows, produced by the repository's Windows workflow, which compiles the app, builds the installer and smoke-tests it. That workflow now runs only when started by hand. Full provider, browser, tool, credential, and task verification is still needed.

### macOS

The [v0.8.2 release](https://github.com/aiden0rchad/nucode/releases/tag/v0.8.2) includes **nucode_0.8.2_aarch64.dmg** for **Apple Silicon Macs**, `macos-arm64-release-manifest.json`, and `SHA256SUMS`.

The package passed the release script's bundle contents, signing, entitlement, bundled-runtime and daemon start-up checks. It uses a **local development signing identity** and is **not notarized**. These checks do not make it a stable release or guarantee opening on every Mac. Follow the [installation steps](getting-started.md#macos-apple-silicon).

There is no Intel Mac installer in this release. Developers can use the [source-build](getting-started.md#build-from-source) and [packaging](packaging.md) instructions.

## Platform matrix

| Area | macOS | Windows x64 | Linux | iOS |
| --- | --- | --- | --- | --- |
| Desktop source/build path | Broadest current verification | CI build/install/startup evidence | Source path; further validation needed | Experimental mobile/remote path |
| Code, Chat, Work | Native checks on the development Mac within documented scope | Full workflow validation needed | Full workflow validation needed | Mobile limitations apply |
| Native browser | WKWebView with same-view agent bridge | WebView2 pane; separate Chromium automation | Chromium path | Experimental; no desktop parity claim |
| Computer use | Experimental native implementation and bounded live checks | No equivalent native verification | No equivalent native verification | Not a desktop-control host |
| Terminal/dictation | Desktop implementation | Feature-level validation needed | Feature-level validation needed | Unavailable in the documented mobile path |
| Signing | Development identity and Keychain checks on one Mac | Unsigned test installer | No release claim | Apple development/signing setup required |

## What has current macOS evidence

The latest acceptance record includes:

- pi/OMP interrupted-turn output and delegation recovery, with owned POSIX process cleanup.
- Code conversation-team persistence, policy isolation, shared limits, and reviewer evidence.
- Bounded cloud/local bugfix and mixed-team checks.
- Work artifacts, transcripts, and preview Open/Stop/Restart behavior.
- Native browser interactions, failure-state tests, and repeated tab cycles.
- Stable development signing and saved Keychain trust across relaunch and a changed code hash on the tested Mac.

The detailed [acceptance record](https://github.com/aiden0rchad/nucode/blob/main/docs/dogfood-acceptance.md) states the scope and remaining uncertainty. A prior unreproduced browser process exit, untested failure injection, another machine's Keychain behavior, or release notarization should not be inferred from those checks.

## Important limitations

- Power-loss durability and complete cross-engine/cross-platform crash recovery are unverified.
- Unknown pricing remains unknown; one local/cloud comparison does not justify automatic routing or quality claims.
- Reported-token caps can overshoot while requests are in flight.
- Custom engines and full-access tools are not a universal OS sandbox.
- Native browser input can be rejected by sites; backend capabilities differ.
- Checkpoints cannot undo external side effects or excluded files.
- The current frontend includes inherited Sentry reporting unless disabled at build time.
- No full VoiceOver/accessibility audit or independent security audit is claimed.

## Update carefully

Keep a backup of important project files and app state. Read the release's source commit and notes, verify provided checksums, and check its signing/notarization status.

For source checkouts, inspect local changes before pulling, install from the committed lockfiles, and fetch any newly needed Cargo dependencies explicitly. Do not delete app data as a routine update step.

nucode checks GitHub Releases for a newer version and can download the compatible installer inside the app, with progress and retry. It opens the completed installer through the operating system; installation remains manual and automatic updater artifacts stay disabled in the Tauri configuration. See [Updates & reporting issues](updates-and-issues.md).

## Follow development

- [Commits](https://github.com/aiden0rchad/nucode/commits/main/) show landed changes.
- [Actions](https://github.com/aiden0rchad/nucode/actions) show documentation and Windows checks.
- [Issues](https://github.com/aiden0rchad/nucode/issues) track reproducible problems and requests.
- [Engineering references](engineering.md) link deeper implementation and acceptance notes.
