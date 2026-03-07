# ADHD Session Runtime Phase (Phase 1)

## Objective
Implement robust host-local Codex runtime orchestration through app-server.

## In Scope
- host-local app-server lifecycle
- typed protocol adapter
- host-local state transitions and interrupt behavior
- workflow-driven workspace lifecycle hooks (`after_create`, `before_run`, `after_run`, `before_remove`)

## Work Items
1. Build host app-server process manager.
2. Implement typed JSON-RPC adapter.
3. Map protocol events to job states.
4. Implement deterministic interrupt/cancel handling.
5. Handle unknown notifications safely.
6. Execute workflow-defined workspace hooks with timeout semantics and safe failure handling.

## Exit Criteria
- host can run job lifecycle end-to-end through app-server
- host-local transitions are deterministic and persisted
- required methods are checked at runtime
- workflow hooks run deterministically and respect workspace safety boundaries

## Current Baseline Artifacts
- `src/runtime/state-machine.js`
- `src/runtime/session-store.js`
- `src/runtime/codex/jsonrpc.js`
- `src/runtime/codex/app-server-process.js`
- `src/runtime/codex/protocol-adapter.js`
- `src/runtime/host-runtime.js`
- `src/server/host-api.js`
- `scripts/start-host-api.mjs`
- `test/*.test.js`

## API Surface (Phase 1 Baseline)
- `POST /api/jobs`
- `GET /api/jobs`
- `GET /api/jobs/:jobId`
- `POST /api/jobs/:jobId/start`
- `POST /api/jobs/:jobId/interrupt`
- `POST /api/approvals/:requestId/approve`
- `POST /api/approvals/:requestId/reject`
- `GET /health`

## Verification Commands
- `npm test`
- `npm run runtime:smoke`
- `npm run host-api:start`
- `npm run phase1:verify`
