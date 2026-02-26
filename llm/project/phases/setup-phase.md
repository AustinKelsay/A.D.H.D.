# ADHD Setup Phase

## Objective
Create a dependable host-trusted baseline so the orchestrator can validate environment prerequisites, accept a canonical session contract, and expose a minimal local entrypoint for phase one smoke checks.

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

1. **Baseline scaffold and runbook**
   - Files: `package.json`, `server.js`, `public/index.html`, `llm/workflows/dev-env-local.md`
   - Done when:
     - `bun run start` launches the setup server.
     - The setup page renders at `http://127.0.0.1:3000`.
     - `bun run health` returns JSON diagnostics.

2. **Session contract + defaults**
   - Files: `config/session-schema.json`, `config/session-defaults.json`
   - Done when:
     - Schema includes `sessionId`, `profile`, `workingDirectory`, `state`, `createdAt`.
     - Profile enum is exactly `basic | edit | git | release`.
- State enum is `queued | awaiting_confirmation | starting | running | completed | failed | cancelled`.

 3. **Host capability checks**
  - File: `scripts/health-check.mjs`
  - Done when:
    - `codex` and `git` required checks fail hard when unavailable.
    - `gh` is checked as optional with clear remediation text.
    - Orchestrator provider config is valid for the selected mode (URL, auth token presence where required, and model availability).
    - Provider failures hard-fail startup in current default policy.
    - Output is machine-parseable JSON including a top-level `ready` flag.

4. **Setup validation and diagnostics loop**
   - Files: `README.md` and linked `llm/project/*` docs
   - Done when:
     - A missing-tool failure can be corrected from one doc page.
     - Docs reference the exact commands used in this phase.

5. **Exit criteria for setup phase**
   - `bun run health` passes in the local host environment.
   - `bun run docs:lint` enumerates docs files.
   - `bun run start` returns the placeholder setup UI.
   - Session schema is ready as a contract for runtime implementation.
