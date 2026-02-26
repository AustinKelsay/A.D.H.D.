# Local Development Workflow

## Prerequisites
- Bun 1.x+
- Optional for native milestones: Rust toolchain for Tauri

## Setup
1. Install dependencies:
   - `bun install`
2. Validate host tooling:
   - `bun run health`

## Development
- Desktop web mode:
  - `bun run start`

## Validation
- Confirm `bun run health` exits cleanly.
- If using non-local orchestrator mode, confirm `ADHD_ORCHESTRATOR_*` values are resolvable and reachable before running a real session.
- Open `http://127.0.0.1:3000` and verify the setup page loads.
- Run `bun run docs:lint` to confirm docs discovery succeeds.

## Notes
- Keep host setup in place: this phase focuses on host checks and baseline scaffolding.
- When phase 1 runtime is ready, switch to the phase-specific workflow documented in `llm/project/phases/session-runtime-phase.md`.
