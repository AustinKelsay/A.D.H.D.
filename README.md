# A.D.H.D.

Agent Dictation Harness Delegator

## Current milestone
Current status: setup phase is stable and in runtime handoff mode (as of 2026-02-26).

## Project Planning

`./llm/project/project-overview.md` is the canonical project plan.

## Setup Phase Quick Start
Current status: setup is complete and ready for phase 1 runtime work.

1. `bun install`
2. `bun run health`
3. `bun run docs:lint` (optional check that docs discovery is healthy)
4. `bun run start`
5. Open `http://127.0.0.1:3000`

## Runtime endpoints (smoke-check surface)

- `POST /api/sessions/intent`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/sessions/:sessionId/start`
- `POST /api/sessions/:sessionId/preview`
- `POST /api/sessions/:sessionId/stop`
- `POST /api/sessions/:sessionId/cancel` (alias for stop)
- `POST /api/sessions/:sessionId/retry`
- `POST /api/sessions/:sessionId/rerun`
- `GET /api/sessions/:sessionId/output` (adds optional `stream=combined|stdout|stderr`)
- `GET /api/sessions/events` (live session state/output stream, SSE)

`GET /api/sessions` also accepts:
- `profile` (exact match, e.g. `git`)
- `from` (ISO timestamp lower bound)
- `to` (ISO timestamp upper bound)
- `sort` (`newest` or `oldest`, default `newest`)

Additional endpoints:
- `POST /api/pair/request` (local clients create a short-lived API token for non-loopback callers)
  - Request body: optional `{ "ttlMs": <positive integer> }` (minimum 1000ms, defaults to `ADHD_PAIR_TOKEN_TTL_MS`).
  - Response: `{ ok, token, expiresAt, expiresInMs, header }`.
  - On invalid `ttlMs`, returns `400` with `errorCode: "invalidPairTtl"`.
- `GET /api/mobile/sessions` (mobile list with progress projection)
- `GET /api/mobile/sessions/:sessionId`
- `POST /api/mobile/sessions/:sessionId/start`
- `POST /api/mobile/sessions/:sessionId/cancel` (alias for stop)
- `POST /api/mobile/sessions/:sessionId/retry`
- `POST /api/mobile/sessions/:sessionId/rerun`
- `GET /api/mobile/sessions/events` (mobile SSE stream with mobile projection)

### Default codex execution behavior

- `POST /api/sessions/:sessionId/start` runs the selected session profile as an active `codex` subprocess.
- `POST /api/sessions/:sessionId/start` accepts optional fields:
  - `args` (array)
  - `timeoutMs`
  - `env` (object)
  - `confirm` (boolean): set `true` to proceed when confidence requires manual confirmation.
- Completed/failed/cancelled terminal sessions receive a persisted `summary` object with:
  - `durationMs`
  - `exitCode`
  - `outputPath`
  - `transcript`
  - `failed`
  - `errorCategory`
  - `recoveryGuidance`
  - `failureReason`
  - Transcript artifacts are written to `outputPath`.
- Defaults can be tuned with environment variables:
- `ADHD_ORCHESTRATOR_PROVIDER` (provider mode: `ollama`, `openai`, `openrouter`, `maple-ai`, or custom; default `ollama`)
- `ADHD_ORCHESTRATOR_BASE_URL` (OpenAI-compatible endpoint URL)
- `ADHD_ORCHESTRATOR_API_KEY` (optional auth token for hosted providers)
- `ADHD_ORCHESTRATOR_MODEL` (model name used by the planner/intent orchestrator)
- `ADHD_ORCHESTRATOR_CHAT_PATH` (optional chat completion endpoint path override)
- `ADHD_ORCHESTRATOR_MODELS_PATH` (optional models endpoint path override)
- `ADHD_ORCHESTRATOR_OPENROUTER_REFERER` (preferred OpenRouter referer header override)
- `ADHD_OPENROUTER_REFERER` (legacy fallback)
- Precedence: if both `ADHD_ORCHESTRATOR_OPENROUTER_REFERER` and `ADHD_OPENROUTER_REFERER` are set, `ADHD_ORCHESTRATOR_OPENROUTER_REFERER` wins.
- `ADHD_OPENROUTER_TITLE` (legacy fallback title) is deprecated in favor of `ADHD_ORCHESTRATOR_OPENROUTER_TITLE` (preferred title override).
- `ADHD_ORCHESTRATOR_OPENROUTER_TITLE` (preferred OpenRouter title header override)
- `ADHD_MAPLE_AI_AUTH_HEADER` (optional maple-ai auth header name)
- `ADHD_ORCHESTRATOR_CUSTOM_AUTH_HEADER` (optional custom provider auth header name)
- `ADHD_CODEX_COMMAND` (execution command, default `codex`)
- `ADHD_CODEX_<PROFILE>_COMMAND` (profile override: `BASIC`, `EDIT`, `GIT`, `RELEASE`)
- `ADHD_CODEX_HELP_ARGS`
- `ADHD_CODEX_<PROFILE>_ARGS` (profile override args for base runtime template)
- `ADHD_CODEX_<PROFILE>_GUARD_ARGS` (profile override guard args)
- `ADHD_CODEX_<PROFILE>_TASK_ARG` (profile override task token)
- `ADHD_CODEX_GUARD_ARGS` (fallback guard args)
- `ADHD_CODEX_TASK_ARG`
- `ADHD_SESSION_PERSIST_PATH` (optional disk snapshot path; defaults to `./data/sessions.json`)
- `ADHD_SESSION_PERSIST_WRITE_DELAY_MS` (debounced persistence delay; default `250`)
- `ADHD_SESSION_RETENTION_DAYS` (terminal session age retention in days; `0` disables)
- `ADHD_SESSION_RETENTION_MAX_COUNT` (max terminal sessions retained; `0` disables)
- `ADHD_RUNNER_RETRY_ENABLED` (`true`/`false`; default `false`)
- `ADHD_RUNNER_MAX_RETRIES` (max retry attempts after first spawn failure; default `1`, minimum `0`)
- `ADHD_RUNNER_RETRY_DELAY_MS` (delay between retries in ms; default `200`)
- `ADHD_RUNNER_TIMEOUT_TERMINAL_STATE` (`failed` or `cancelled`; default `failed`)
- `ADHD_PAIR_TOKEN_TTL_MS` (pairing token lifetime in ms; default `600000`)
- `ADHD_MAX_CONCURRENT_SESSIONS` (runner concurrency cap; default `1`)
- `ADHD_START_QUEUE_POLICY` (`queue` to enqueue, `reject` to return `429` when full; default `queue`)
- `ADHD_RETRY_ACTION_IDEMPOTENCY_MS` (dedupe window for concurrent retry actions by sessionId; default `30000`)
- `ADHD_SESSION_TIMEOUT_MS` sets the default session timeout in milliseconds.
- `ADHD_MOBILE_ACTION_IDEMPOTENCY_MS` controls dedupe window for `x-adhd-action-id` mobile action replays; defaults to `30000`.

Current failure policy: planner/provider failure is a hard fail (no execution without a valid plan). If the planner returns a plan that requires confirmation, start returns HTTP `409` with `requiresConfirmation: true` and state `awaiting_confirmation` until `/start` is retried with `{"confirm":true}`.

Failure categories are now surfaced on recovery-oriented fields:
- Terminal/session summaries include `errorCategory` plus `recoveryGuidance`.
- Validation-level failures (such as `POST /api/sessions/intent` with missing/invalid profile) include `errorCategory` and `recoveryGuidance`.
- Planning or transport failures include `errorCategory` such as `missing-tool`, `invalid-profile`, or `transport-loss`.

Server restarts restore sessions from the persisted snapshot; terminal (`completed`/`failed`/`cancelled`) sessions remain stable, while active (`starting`/`running`) sessions are reconciled to `failed` with `errorCategory: server-restart` and recovery guidance for the next action.

Runner start failures can be retried when `ADHD_RUNNER_RETRY_ENABLED=true`, with bounded backoff configured by `ADHD_RUNNER_MAX_RETRIES` and `ADHD_RUNNER_RETRY_DELAY_MS`. Retry errors are kept in `session.runtime.lastRetryError` and session remains in `starting` until final decision.

On runner timeout (`ADHD_SESSION_TIMEOUT_MS`), terminal behavior is controlled by `ADHD_RUNNER_TIMEOUT_TERMINAL_STATE` (`failed` default, or `cancelled`).

`POST /api/sessions/:sessionId/preview` performs a planning pass only (no runner start), and returns `{ ok: true, plan: ... }` with the projected codex invocation.
- `POST /api/sessions/:sessionId/rerun` can clone and relaunch from an existing terminal session. You can optionally pass a different profile:
  - `{"profile":"edit"}`

When confirmation is required, `/start` errors include `planPreview` so clients can render exactly what would be executed before retrying with `{"confirm": true}`.

Current session states: `queued`, `awaiting_confirmation`, `starting`, `running`, `completed`, `failed`, `cancelled`.

In this architecture, the orchestrator layer is OpenAI-compatible planning logic that turns transcript/task text into safe codex invocation specs. The execution layer is active and runs the configured `codex` CLI worker.

If you want guaranteed local completion while validating this phase, you can override command to:
`{ "command": "bash", "args": ["-lc", "echo ok"] }` and avoid depending on codex behavior.

## Runtime queue policy smoke checks

Run these with the server listening on `127.0.0.1:3000` and a reachable orchestrator.
If your environment blocks loopback binding (`listen 127.0.0.1 ... EPERM`), run the smoke script in a host where local binding is allowed, or skip automated smoke checks and run the manual curl sequence below.

You can run the automated version directly:

```bash
bash scripts/queue-smoke.sh
```

## Verification sweeps

### Phase 2 provider adapter coverage (ADHD-205)

```bash
bash scripts/adhd-205-adapter-sweep.sh
```

Or via npm script:

```bash
bun run adapter-sweep
```

### Phase 2 confidence gating coverage (ADHD-206)

```bash
bash scripts/adhd-206-confidence-gating-sweep.sh
```

Or via npm script:

```bash
bun run confidence-gating-sweep
```

### Phase 3 controls coverage (ADHD-304)

```bash
bash scripts/adhd-304-controls-sweep.sh
```

Or via npm script:

```bash
bun run controls-sweep
```

### Phase 4 mobile control/auth coverage (ADHD-402)

```bash
bash scripts/adhd-402-mobile-controls-sweep.sh
```

Or via npm script:

```bash
bun run mobile-controls-sweep
```

### Phase 4 responsive mobile views (ADHD-403)

```bash
bash scripts/adhd-403-mobile-view-sweep.sh
```

Or via npm script:

```bash
bun run mobile-view-sweep
```

### Phase 4 cross-device action parity (ADHD-404)

```bash
bash scripts/adhd-404-cross-device-action-sweep.sh
```

Or via npm script:

```bash
bun run mobile-action-semantics-sweep
```

### Phase 3 summary persistence coverage (ADHD-303)

```bash
bash scripts/adhd-303-summary-sweep.sh
```

Or via npm script:

```bash
bun run summary-sweep
```

### Hardening verification sweep (ADHD-602)

Run the targeted hardening checks for recovery/reconnect behavior:

```bash
bun run hardening-sweep
```

### Shared helper

```bash
BASE_URL="http://127.0.0.1:3000"

create_intent() {
  local label=$1
  curl -sS -X POST "$BASE_URL/api/sessions/intent" \
    -H "Content-Type: application/json" \
    -d "{\"profile\":\"basic\",\"taskText\":\"$label\"}" \
    | jq -r '.session.sessionId'
}

start_session() {
  local session_id=$1
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/start" \
    -H "Content-Type: application/json" \
    -d '{"confirm":true,"command":"bash","args":["-lc","sleep 30"]}' \
    -o "$response_file" \
    -w '%{http_code}' )"
  cat "$response_file"
  echo "___STATUS___$status"
  rm -f "$response_file"
}
```

### 1) Queue mode (default)

```bash
ADHD_MAX_CONCURRENT_SESSIONS=1 ADHD_START_QUEUE_POLICY=queue bun run start
```

```bash
S1=$(create_intent "first queue smoke")
S2=$(create_intent "second queue smoke")
start_session "$S1"
start_session "$S2"
```

Expected on `$S2`:
- HTTP `200`
- `queued: true`
- `queueStatus.policy` equals `"queue"`

### 2) Reject mode

```bash
ADHD_MAX_CONCURRENT_SESSIONS=1 ADHD_START_QUEUE_POLICY=reject bun run start
```

```bash
S1=$(create_intent "first reject smoke")
S2=$(create_intent "second reject smoke")
start_session "$S1"
start_session "$S2" | jq
```

Expected on `$S2`:
- HTTP `429`
- `ok: false`
- `errorCode: "RUNNER_QUEUE_FULL"`
- `queueBlocked: true`
- `queueStatus.policy` equals `"reject"`

## Reference docs

- `./llm/project/project-overview.md`
- `./llm/project/backlog.md`
- `./llm/project/phases/setup-phase.md`
- `./llm/project/phases/session-runtime-phase.md`
- `./llm/workflows/dev-env-local.md`
