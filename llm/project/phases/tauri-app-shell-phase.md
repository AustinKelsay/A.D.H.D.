# ADHD Tauri App Shell Phase (Phase 11)

## Status
Complete.

## Objective
Establish the first real client shell for ADHD using Tauri v2, with one app codebase targeting desktop first and preserving the same architectural path for mobile.

## In Scope
- Tauri v2 project scaffold and repo placement
- shell-level desktop app structure
- shared client-side API layer for host and federation routes
- local development workflow against the existing backend
- app-level health/readiness surface for host and federation

## Out of Scope
- full desktop operator UX parity
- production mobile app polish
- microphone capture and dictation runtime
- bundled ASR model/runtime integration

## Work Items
1. Create the Tauri shell workspace and project layout.
2. Define shared API client boundaries for host and federation endpoints.
3. Build a minimal shell UI that can display health and connection readiness.
4. Define environment/config strategy for local dev, staging, and packaged builds.
5. Establish a Phase 11 verification gate for docs and shell scaffold integrity.

## Exit Criteria
- a Tauri app shell exists in-repo and is structured for desktop-first development
- the shell can talk to host/federation health endpoints in local development
- desktop shell boundaries are explicit enough to support later mobile and dictation work without re-architecture

## Planned Artifacts
- app shell workspace under `apps/`
- Phase 11 verification command
- shared client config/environment contract
- Tauri shell bootstrap/runbook

## Current Baseline Artifacts
- `apps/adhd-shell/README.md`
- `apps/adhd-shell/package.json`
- `apps/adhd-shell/src/`
- `apps/adhd-shell/src-tauri/`
- `scripts/check-phase11-scaffold.mjs`
- `llm/workflows/phase-11-tauri-shell-bootstrap.md`

## Delivered
- Tauri v2 app shell scaffold exists under `apps/adhd-shell`
- shell frontend reads host and federation health directly through a shared client boundary
- root workspace commands exist for shell web dev, shell build, and Tauri dev
- Phase 11 verification now checks docs, scaffold integrity, frontend build, and Rust/Tauri compile

## Verification
- `npm run phase11:verify`
