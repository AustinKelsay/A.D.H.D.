# ADHD Setup Phase

## Objective
Create a dependable host-trusted baseline so the orchestrator can validate environment prerequisites, accept a canonical session contract, and expose a minimal local entrypoint for phase one smoke checks.

Current status: all phase-0 outcomes are complete in documentation and checks; this phase is in stable handoff mode.

## Inputs
- `llm/project/project-overview.md`
- `llm/project/project-rules.md`
- `llm/workflows/dev-env-local.md`

## Scope
- In-scope:
  - Host/tooling checks and bootstrap visibility
  - Session schema and defaults
  - Local service entrypoint for phase smoke checks
  - Orchestrator provider adapter config checks and dry-run validation
  - Setup doc and workflow standardization
- Out-of-scope:
  - Codex process orchestration
  - Mobile transport/authentication
  - Persistent session store beyond schema definitions

## Phase 0 Work (Owner: you/agent)

- [x] **1. Baseline scaffold and runbook**
  - Files: `package.json`, `server.js`, `public/index.html`, `llm/workflows/dev-env-local.md`
  - Done when:
    - [x] `bun run start` launches the setup server.
    - [x] The setup page renders at `http://127.0.0.1:3000`.
    - [x] `bun run health` returns JSON diagnostics.

- [x] **2. Session contract + defaults**
  - Files: `config/session-schema.json`, `config/session-defaults.json`
  - Done when:
    - [x] Schema includes `sessionId`, `profile`, `workingDirectory`, `state`, `createdAt`.
    - [x] Profile enum is exactly `basic | edit | git | release`.
    - [x] State enum includes `queued | awaiting_confirmation | starting | running | completed | failed | cancelled`.

- [x] **3. Host capability checks**
  - File: `scripts/health-check.mjs`
  - Done when:
    - [x] `codex` and `git` required checks fail hard when unavailable.
    - [x] `gh` is checked as optional with clear remediation text.
    - [x] Orchestrator provider config is valid for the selected mode (URL, auth token presence where required, and model availability).
    - [x] Provider failures hard-fail startup in current default policy.
    - [x] Output is machine-parseable JSON including a top-level `ready` flag.

- [x] **4. Setup validation and diagnostics loop**
  - Files: `README.md` and linked `llm/project/*` docs
  - Done when:
    - [x] A missing-tool failure can be corrected from one doc page.
    - [x] Docs reference the exact commands used in this phase.

- [x] **5. Exit criteria for setup phase**
  - [x] `bun run health` passes in the local host environment.
  - [x] `bun run docs:lint` enumerates docs files.
  - [x] `bun run start` returns the placeholder setup UI.
  - [x] Session schema is ready as a contract for runtime implementation.

## Phase 1 handoff checklist (setup near complete)

1. Keep the setup baseline stable while beginning runtime implementation:
   - `llm/project/phases/session-runtime-phase.md`: wire session lifecycle transitions from intent to execution.
   - `llm/project/phases/intent-router-phase.md`: finalize execution contract and caller responses for confirmation-required states.

2. Add a lightweight runtime readiness gate in onboarding docs once phase 1 endpoints are introduced.

3. Keep docs in sync with any changed response shapes before enabling phase 1 features in the app shell.

4. Mark this phase complete in `llm/project/backlog.md` once runtime handoff criteria below are verified:
   - setup health checks are green for required tools,
   - schema contracts are accepted by startup,
   - baseline UI/smoke path loads,
   - session start/stop contracts align with `session-runtime-phase.md`.

5. After the handoff is accepted, move planning ownership to runtime workstream items and continue phase sequencing from `session-runtime-phase.md`.
