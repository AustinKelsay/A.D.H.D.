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
- `POST /api/sessions/:sessionId/stop`

### Default codex execution behavior

- `POST /api/sessions/:sessionId/start` runs the selected session profile as an active `codex` subprocess.
- `POST /api/sessions/:sessionId/start` accepts optional fields:
  - `args` (array)
  - `timeoutMs`
  - `env` (object)
  - `confirm` (boolean): set `true` to proceed when confidence requires manual confirmation.
- Defaults can be tuned with environment variables:
  - `ADHD_ORCHESTRATOR_PROVIDER` (provider mode: `ollama`, `openai`, `openrouter`, `maple-ai`, or custom; default `ollama`)
  - `ADHD_ORCHESTRATOR_BASE_URL` (OpenAI-compatible endpoint URL)
  - `ADHD_ORCHESTRATOR_API_KEY` (optional auth token for hosted providers)
  - `ADHD_ORCHESTRATOR_MODEL` (model name used by the planner/intent orchestrator)
  - `ADHD_CODEX_COMMAND` (execution command, default `codex`)
  - `ADHD_CODEX_HELP_ARGS`
  - `ADHD_CODEX_TASK_ARG`
  - `ADHD_MAX_CONCURRENT_SESSIONS` (runner concurrency cap; default `1`)
  - `ADHD_START_QUEUE_POLICY` (`queue` to enqueue, `reject` to return `429` when full; default `queue`)
- `ADHD_SESSION_TIMEOUT_MS` sets the default session timeout in milliseconds.

Current failure policy: planner/provider failure is a hard fail (no execution without a valid plan). If the planner returns a plan that requires confirmation, start returns HTTP `409` with `requiresConfirmation: true` and state `awaiting_confirmation` until `/start` is retried with `{"confirm":true}`.

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
