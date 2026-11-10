# M21 — Detect and set image support per model (agents can see browser screenshots)

## Problem (real app, 2026-11-09)
The agent called `browser_take_screenshot` and omp replied
"[image omitted: the active model does not support image input]". The model (GPT 6.1 Sol via the user's
LiteLLM, an OpenAI-compatible provider) supports images, but nucode's catalog has `supportsImages: null`
for every fetched model (`src-tauri/src/shared/providers.rs` `fetch` sets `supports_images: None`), and
`src-tauri/src/shared/pi/config.rs` only writes omp/pi `input` when it is `Some`, so engines treat the model
as text-only. There is no way to change it in Settings.

## Goal
1. "Test & fetch models" detects image support where the provider reports it.
2. The user can set it per model (Auto / On / Off) in Settings → Providers.
3. Engines receive `input: ["text","image"]` when supported.

## Changes
1. **Detection in `fetch`** (keep it best-effort; a failure never fails the fetch, and never overrides a
   user's explicit choice — see 2):
   - OpenRouter list entries: `architecture.input_modalities` contains `"image"` → true (else false when the
     field exists).
   - Ollama: when the list gives no capability, `POST {base}/api/show {"model": id}` and read
     `capabilities` containing `"vision"` (only if cheap; cap to 50 models per fetch).
   - OpenAI-compatible (incl. LiteLLM proxies) and OpenAI: after listing, try `GET {base}/model/info`
     (LiteLLM; also try `{base without /v1}/model/info`), map each `data[].model_name` /
     `data[].model_info.key` to the listed ids and use `model_info.supports_vision` (bool). Ignore 404/401.
   - Google list entries: `supportedGenerationMethods` doesn't say; leave `None` unless the entry has an
     explicit modality field.
   - Anthropic: Claude 3+ models support images → true for ids starting with `claude-` (documented by the
     provider), else None.
   Unit tests with the existing `FakeHttp` for each path (OpenRouter modalities, LiteLLM model/info hit and
   404, Ollama show, explicit user override preserved by `merge_models`).
2. **User override**: `merge_models` must keep a user-set `supports_images` (add a
   `supports_images_source: "user" | "detected"` or similar persisted marker, serde-defaulted) so a re-fetch
   doesn't clobber it. In `src/features/settings/components/sections/SettingsRegistrySections.tsx`, add a
   compact per-model "Images" control (Auto / On / Off) next to the existing per-model controls; Auto clears
   the user marker and shows the detected value as hint text ("Detected: yes/no/unknown"). Types in
   `src/types.ts`. Tests.
3. **Engines**: `pi/config.rs` already maps `supports_images` → `input`; make sure the omp `models.yml`
   (`profile.rs::omp_models`) and the codex/claude paths (if they have an equivalent) carry it, and add a
   test that a model with `supports_images: Some(true)` yields `input: ["text","image"]` in omp models.

## Files
`src-tauri/src/shared/providers.rs` (+ tests), `src-tauri/src/types.rs`, `src-tauri/src/shared/pi/{config.rs,profile.rs,tests.rs}`,
`src/types.ts`, `src/features/settings/components/sections/SettingsRegistrySections.tsx` (+ test).
Off-limits: browser code, other specs, new crates.

## Verification
From `apps/nucode/src-tauri`:
```
PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib shared::providers && PATH="$HOME/.cargo/bin:$PATH" CARGO_HOME=$HOME/nucode/.cargo-home TMPDIR=$HOME/nucode/.tmp cargo test --lib shared::pi::
```
From `apps/nucode`: `npx tsc --noEmit && npx vitest run src/features/settings`. All must pass.
