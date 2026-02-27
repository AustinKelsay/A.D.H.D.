# ADHD Session Runtime Phase

## Goals
- Build a deterministic session orchestration core independent of UI and transport.
- Ensure codex process lifecycle control is reliable across completion and cancellation.

## Inputs
- `llm/project/project-overview.md`
- `llm/project/project-rules.md`

## Scope
- In scope: runner queue, process spawn, state machine, timeout/cancel behavior.
- Out of scope: orchestration provider routing and model prompt behavior (phase 2).

## Steps (per feature)
1. **Session model**
  - Keep a canonical session object from the setup contract (`sessionId`, `profile`, `workingDirectory`, `state`, `createdAt`, `stateHistory`, `runtime`).
  - Use in-memory catalog for phase-1 local runner verification.
2. **Contract runner stub**
  - Add `POST /api/sessions/intent` to create a queued session stub from raw/normalized task text.
  - Add `POST /api/sessions/:id/start` with optional `{ command, args, timeoutMs, env }` overrides.
3. **State transitions**
  - Enforce stable transitions: `queued -> awaiting_confirmation? -> starting -> running -> completed/failed/cancelled`.
  - Reject any invalid transition with deterministic error.
4. **Failure, completion, and cancellation**
  - Add `POST /api/sessions/:id/stop` and `GET /api/sessions`, `GET /api/sessions/:id`.
  - Replace stub timer flow with plan-driven `codex` subprocess launch in `starting -> running`.
  - If planner confidence/action policy requires confirmation, keep `queued` sessions in `awaiting_confirmation` until `/start` is retried with confirmation.
  - Confirm terminal states close execution timer and process handles.
  - Keep execution command source-of-truth in session runtime; only accept launch specs that pass planner validation.
   - Respect `ADHD_START_QUEUE_POLICY`:
     - `queue` (default): queue new `/start` requests when `ADHD_MAX_CONCURRENT_SESSIONS` is reached.
     - `reject`: return a queue-full `429` response when max concurrency is reached.
      - For `reject`, `/api/sessions/:id/start` should emit:
        - `errorCode: "RUNNER_QUEUE_FULL"`
        - `queueBlocked: true`
        - `queueStatus` snapshot including `policy`, `maxConcurrentSessions`, `activeCount`, and `queuedCount`.
5. **Readiness for codex orchestration**
  - Keep transition logic and response shape stable enough for profile-based codex command evolution and orchestrator-provider metadata in subsequent phases.

## Exit Criteria
- Runtime can process and track at least one job end-to-end without UI involvement (intent -> start -> completed/failed/cancelled).
- `GET /api/sessions` lists every created session with latest state.
- `POST /api/sessions/:id/start` and `/stop` perform deterministic transitions.
- Cancel and timeout paths terminate subprocesses cleanly.
- State transitions are deterministic and idempotent when called repeatedly.
- `ADHD_START_QUEUE_POLICY=reject` yields dedicated 429 queue-full responses (`errorCode: RUNNER_QUEUE_FULL`) when capacity is exceeded.
