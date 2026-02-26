# Local Development Workflow

## Prerequisites
- Bun 1.x+
- Optional for native milestones: Rust toolchain for Tauri

## Setup
1. Install dependencies:
   - `bun install`
2. Validate host tooling:
   - `bun run health` (required for setup validation)
   - `bun run docs:lint` (optional preflight check for docs discoverability)

## Development
- Desktop web mode:
  - `bun run start`

## Validation
- Confirm `bun run health` exits cleanly.
- If using non-local orchestrator mode, confirm `ADHD_ORCHESTRATOR_*` values are resolvable and reachable before running a real session.
- Open `http://127.0.0.1:3000` and verify the setup page loads.
- Confirm `bun run docs:lint` to validate docs discovery when onboarding.
- Keep setup baseline stable while runtime milestones begin (session/runtime contracts are the next gate).

## Notes
- Keep host setup in place: this phase is now stable and focused on moving into runtime implementation.
- When phase 1 runtime is ready, switch to the phase-specific workflow documented in `llm/project/phases/session-runtime-phase.md`.
