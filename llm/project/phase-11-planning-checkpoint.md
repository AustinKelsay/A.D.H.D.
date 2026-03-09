# Phase 11 Planning Checkpoint

## Verified Date
- 2026-03-08 (US/Pacific)

## Branch State
- Current working branch: `codex/mvp-phase-11`
- Branch base:
  - `main` was pulled to latest
  - `staging` was rebased onto latest `main`
  - `codex/mvp-phase-11` was created from rebased `staging`

## What Changed In This Session

### 1. Local onboarding was simplified
The repo now has a straightforward local-first path instead of requiring operators to mentally map multiple phase runbooks before first use.

Added:
- `README.md`
- `scripts/local-up.mjs`
- `scripts/local-smoke.mjs`
- `scripts/shared/local-stack-utils.mjs`

Updated:
- `package.json`
- `scripts/docs-lint.mjs`
- `scripts/start-host-api.mjs`
- `scripts/start-federation-api.mjs`
- `llm/README.md`
- `llm/workflows/phase-9-host-bootstrap.md`

New primary local commands:
- `npm run health`
- `npm run local:smoke`
- `npm run local:up`

Behavior of the simplified local scripts:
- start host API and federation API with distinct default ports
- auto-bootstrap one local federated host (`h_alpha01`)
- expose a single-command smoke path
- emit explicit runtime failure diagnostics instead of vague port/health failures

### 2. Runtime startup behavior was clarified
The APIs can come up even when Codex runtime initialization has not completed successfully.

Observed behavior:
- `npm run health` passing means the machine has a working `codex` CLI and required subcommands
- that does not guarantee host runtime initialization will succeed within the default JSON-RPC timeout

Relevant override added:
- `ADHD_RPC_REQUEST_TIMEOUT_MS`

Recommended fallback when local startup is slow:
```bash
ADHD_RPC_REQUEST_TIMEOUT_MS=120000 npm run local:smoke
```

Deep runtime diagnostic:
```bash
ADHD_RUNTIME_SMOKE_TIMEOUT_MS=60000 node scripts/runtime-smoke.mjs --initialize
```

### 3. Product boundary was clarified
The current repo is primarily the control-plane and host runtime layer.

Implemented today:
- host API
- federation/control-plane API
- mobile pairing/session API surface
- unified intake API that accepts text or already-transcribed voice payloads

Not implemented today:
- desktop UI
- mobile app
- microphone capture
- built-in dictation UX
- bundled speech-to-text runtime

Important implication:
- ADHD can piggyback on a machine where `codex` is already installed and working
- ADHD does not yet provide an end-user OAuth/login/onboarding flow similar to OpenClaw
- voice-first product intent exists in the architecture, but the actual user-facing dictation client does not yet exist in this repo

## Smoke Test Findings On This Machine

Confirmed:
- `bun install` completed
- `bun run health` passed

Observed:
- `bun run local:smoke` was interrupted manually before completion
- `bun run local:up` began startup and printed expected default-config lines
- local startup may require a higher Codex JSON-RPC timeout depending on machine/runtime behavior

Interpretation:
- compatibility gate is green
- full local stack usability depends on Codex runtime initialize latency, not just binary presence

## Planning Decision For Next Roadmap
The next major work should move from backend/operator surface to actual product clients.

Recommended next phases:
1. Tauri app shell
2. Desktop MVP UI
3. Mobile app parity
4. Dictation capture layer
5. ASR runtime integration (`Whispr` on desktop, native/mobile-appropriate path on phone)
6. Packaging and onboarding

## Tauri / Whispr Direction Agreed In Session
- Desktop and mobile should be delivered through a Tauri-based client strategy
- Dictation should be bundled into that client work, not left as a separate operator concern
- `Whispr CLI` bundling makes sense as a desktop-side integration boundary
- mobile should not assume the same CLI sidecar model; prefer a native/mobile plugin boundary there

## Where Phase 11 Actually Stands Right Now
- Phase 10 is complete
- no formal Phase 11 docs were written yet during this session
- no Tauri app scaffold was created yet during this session
- the next implementation step is to formalize Phase 11 in docs/backlog and then scaffold the Tauri shell

## Immediate Next Step
- checkpoint this branch and move to the next smoke-test pass
