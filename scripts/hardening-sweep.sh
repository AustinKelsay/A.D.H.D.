#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3000
fi

MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-45}"
SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCH_PORT="${MOCK_ORCHESTRATOR_PORT:-11435}"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-hardening-server.log"
MOCK_LOG_FILE="$SCRIPT_LOG_DIR/adhd-mock-orchestrator.log"
PERSIST_PATH="$SCRIPT_LOG_DIR/adhd-hardening-sessions.json"

if ! command -v curl >/dev/null 2>&1; then
  echo "Required command not found: curl" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Required command not found: jq" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Required command not found: bun" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Required command not found: node" >&2
  exit 1
fi

assert() {
  local label="$1"
  local actual="$2"
  local expected="$3"

  if [[ "$actual" != "$expected" ]]; then
    echo "ASSERTION FAILED [$label]: expected '$expected', got '$actual'" >&2
    return 1
  fi
  echo "✓ $label: $actual"
}

assert_nonempty() {
  local label="$1"
  local value="$2"

  if [[ -z "$value" || "$value" == "null" ]]; then
    echo "ASSERTION FAILED [$label]: expected non-empty value" >&2
    return 1
  fi
  echo "✓ $label: $value"
}

create_intent() {
  local label="$1"
  local payload response_file

  payload="$(jq -nc --arg l "$label" '{"profile":"basic","taskText":$l}')"
  response_file="$(mktemp)"

  if ! curl -sS -X POST "$BASE_URL/api/sessions/intent" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    -o "$response_file"; then
    rm -f "$response_file"
    return 1
  fi

  local session_id
  session_id="$(jq -r '.session.sessionId // empty' "$response_file")"
  rm -f "$response_file"

  if [[ -z "$session_id" ]]; then
    return 1
  fi

  if [[ ! "$session_id" =~ ^s_[a-z0-9]+_[a-z0-9]+$ ]]; then
    echo "Invalid session id returned: $session_id" >&2
    return 1
  fi

  echo "$session_id"
}

start_session() {
  local session_id="$1"
  local request_payload="$2"
  local response_file status

  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/start" \
    -H "Content-Type: application/json" \
    -d "$request_payload" \
    -o "$response_file" \
    -w '%{http_code}')"

  cat "$response_file"
  echo "___STATUS___$status"

  rm -f "$response_file"
}

get_session_state() {
  local session_id="$1"
  local response_file
  response_file="$(mktemp)"
  local state

  if ! curl -sS -X GET "$BASE_URL/api/sessions/$session_id" -o "$response_file" >/dev/null 2>&1; then
    rm -f "$response_file"
    return 1
  fi

  state="$(jq -r '.session.state // empty' "$response_file")"
  local summary_category
  summary_category="$(jq -r '.session.summary.errorCategory // empty' "$response_file")"
  local summary_guidance
  summary_guidance="$(jq -r '.session.summary.recoveryGuidance // empty' "$response_file")"
  local runtime_error
  runtime_error="$(jq -r '.session.runtime.error // empty' "$response_file")"

  printf '%s|%s|%s|%s' "$state" "$summary_category" "$summary_guidance" "$runtime_error"
  rm -f "$response_file"
}

wait_for_session_state() {
  local session_id="$1"
  local expected_state="$2"
  local timeout_seconds="${3:-$MAX_WAIT_SECONDS}"

  local remaining="$timeout_seconds"
  while ((remaining > 0)); do
    local payload
    payload="$(get_session_state "$session_id" || true)"
    local state="${payload%%|*}"

    if [[ "$state" == "$expected_state" ]]; then
      echo "$payload"
      return 0
    fi

    if [[ "$expected_state" == "completed" || "$expected_state" == "failed" || "$expected_state" == "cancelled" ]]; then
      if [[ "$state" == "failed" || "$state" == "cancelled" || "$state" == "completed" ]]; then
        echo "$payload"
        return 1
      fi
    fi

    sleep 1
    remaining=$((remaining - 1))
  done

  echo "" 
  return 1
}

start_mock_orchestrator() {
  local port="$1"
  local log_file="$2"

  cat > "$SCRIPT_LOG_DIR/adhd-mock-orchestrator.mjs" <<'MOCK'
import http from 'node:http';

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11435);
const payload = {
  id: 'mock-plan',
  choices: [
    {
      message: {
        content: JSON.stringify({
          profile: 'basic',
          confidence: 0.99,
          requiresConfirmation: false,
          reason: 'hardening test plan',
          args: [],
          selectedProfile: 'basic',
        }),
      },
    },
  ],
};

const server = http.createServer((req, res) => {
  if (req.url === '/api/tags' || req.url === '/models' || req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"models":[{"name":"hardening-model"}]}');
    return;
  }

  if (
    req.url === '/chat/completions'
    || req.url === '/v1/chat/completions'
    || req.url === '/api/chat/completions'
  ) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"error":"not-found"}');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock orchestrator listening ${port}`);
});

setInterval(() => {
  // keep process alive
}, 1000);
MOCK

  MOCK_ORCHESTRATOR_PORT="$port" node "$SCRIPT_LOG_DIR/adhd-mock-orchestrator.mjs" >"$log_file" 2>&1 &
  export MOCK_ORCH_PID=$!
  echo $MOCK_ORCH_PID
}

wait_for_server() {
  local timeout=15
  for _ in $(seq 1 "$timeout"); do
    if curl -sS "$BASE_URL/api/sessions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Server failed to become reachable at $BASE_URL" >&2
  return 1
}

start_server() {
  local policy="$1"
  local persist_path="$2"
  local log_file="$SERVER_LOG_FILE"
  local pid_file="$SCRIPT_LOG_DIR/adhd-hardening-server.pid"

  ADHD_MAX_CONCURRENT_SESSIONS=1 \
  ADHD_START_QUEUE_POLICY="$policy" \
  ADHD_SESSION_PERSIST_PATH="$persist_path" \
  ADHD_ORCHESTRATOR_PROVIDER=custom \
  ADHD_ORCHESTRATOR_BASE_URL="http://127.0.0.1:$MOCK_ORCH_PORT" \
  ADHD_ORCHESTRATOR_CHAT_PATH="/chat/completions" \
  ADHD_ORCHESTRATOR_MODELS_PATH="/api/tags" \
  PORT="$PORT" \
  node server.js > "$log_file" 2>&1 &

  local server_pid="$!"
  echo "$server_pid" > "$pid_file"

  if ! wait_for_server; then
    tail -n 120 "$SERVER_LOG_FILE" >&2 || true
    return 1
  fi

  echo "$server_pid"
}

stop_server() {
  local pid_file="$SCRIPT_LOG_DIR/adhd-hardening-server.pid"
  local server_pid=""
  if [[ -f "$pid_file" ]]; then
    server_pid="$(cat "$pid_file")"
  fi

  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill -TERM "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
  fi

  rm -f "$pid_file"
}

stop_mock_orchestrator() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill -TERM "$pid" >/dev/null 2>&1 || true
    wait "$pid" 2>/dev/null || true
  fi
}

run_cancellation_startup() {
  echo "== test: startup cancellation transitions safely"

  local persist_path="$SCRIPT_LOG_DIR/adhd-hardening-cancel.json"
  rm -f "$persist_path"

  local server_pid mock_pid
  mock_pid="$(start_mock_orchestrator "$MOCK_ORCH_PORT" "$MOCK_LOG_FILE")"
  server_pid="$(start_server queue "$persist_path")"

  local session_id start_payload response status payload
  session_id="$(create_intent "hardening startup cancel")"
  start_payload='{"confirm":true,"command":"bash","args":["-lc","sleep 20"]}'

  response="$(start_session "$session_id" "$start_payload")"
  status="${response##*___STATUS___}"
  assert "startup cancellation: initial start status" "$status" "200"

  start_payload='{"confirm":true,"command":"bash","args":["-lc","sleep 1"]}'
  curl -sS -X POST "$BASE_URL/api/sessions/$session_id/stop" -H "Content-Type: application/json" -d '{}' >/dev/null

  local observed
  observed="$(wait_for_session_state "$session_id" "cancelled" "8" || true)"
  if [[ -z "$observed" ]]; then
    echo "ASSERTION FAILED [startup cancellation]: session did not reach terminal state" >&2
    stop_server
    stop_mock_orchestrator "$mock_pid"
    return 1
  fi

  IFS='|' read -r final_state final_category final_guidance <<< "$observed"
  assert "startup cancellation: final state" "$final_state" "cancelled"

  stop_server
  stop_mock_orchestrator "$mock_pid"

  return 0
}

run_host_tool_disappears() {
  echo "== test: host tool disappears mid-session -> guided recovery"

  local persist_path="$SCRIPT_LOG_DIR/adhd-hardening-midrun.json"
  rm -f "$persist_path"

  local server_pid mock_pid
  mock_pid="$(start_mock_orchestrator "$MOCK_ORCH_PORT" "$MOCK_LOG_FILE")"
  server_pid="$(start_server queue "$persist_path")"

  local session_id start_payload response status payload
  session_id="$(create_intent "hardening host tool disappears")"
  start_payload='{"confirm":true,"command":"bash","args":["-lc","nonexistent_host_tool_should_not_exist_12345"],"timeoutMs":8000}'

  response="$(start_session "$session_id" "$start_payload")"
  status="${response##*___STATUS___}"
  assert "mid-session host loss: initial start status" "$status" "200"

  local observed
  observed="$(wait_for_session_state "$session_id" "failed" "12" || true)"
  if [[ -z "$observed" ]]; then
    echo "ASSERTION FAILED [mid-session host loss]: session did not fail" >&2
    stop_server
    stop_mock_orchestrator "$mock_pid"
    return 1
  fi

  IFS='|' read -r final_state final_category final_guidance final_runtime_error <<< "$observed"
  assert "mid-session host loss: final state" "$final_state" "failed"
  assert_nonempty "mid-session host loss: failure runtime error" "$final_runtime_error"
  assert_nonempty "mid-session host loss: recovery guidance" "$final_guidance"

  stop_server
  stop_mock_orchestrator "$mock_pid"
  return 0
}

run_reconnect_reconciliation() {
  echo "== test: reconnect reconciliation closes stale running session"

  local persist_path="$SCRIPT_LOG_DIR/adhd-hardening-reconnect.json"
  rm -f "$persist_path"

  local mock_pid server_pid
  mock_pid="$(start_mock_orchestrator "$MOCK_ORCH_PORT" "$MOCK_LOG_FILE")"
  server_pid="$(start_server queue "$persist_path")"

  local session_id start_payload response status payload
  session_id="$(create_intent "hardening reconnect test")"
  start_payload='{"confirm":true,"command":"bash","args":["-lc","sleep 30"]}'

  response="$(start_session "$session_id" "$start_payload")"
  status="${response##*___STATUS___}"
  assert "reconnect: initial start status" "$status" "200"

  local wait_running
  wait_running="$(wait_for_session_state "$session_id" "running" "8" || true)"
  if [[ -z "$wait_running" ]]; then
    echo "ASSERTION FAILED [reconnect]: session did not start"
    stop_server
    stop_mock_orchestrator "$mock_pid"
    return 1
  fi

  kill -9 "$server_pid" >/dev/null 2>&1 || true
  sleep 1

  SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-hardening-server-restart.log"
  server_pid="$(start_server queue "$persist_path")"

  local observed
  observed="$(wait_for_session_state "$session_id" "failed" "8" || true)"
  if [[ -z "$observed" ]]; then
    echo "ASSERTION FAILED [reconnect]: recovered session not terminal"
    stop_server
    stop_mock_orchestrator "$mock_pid"
    return 1
  fi

  IFS='|' read -r final_state final_category final_guidance final_runtime_error <<< "$observed"
  assert "reconnect: final state" "$final_state" "failed"
  assert "reconnect: recovery category" "$final_category" "server-restart"
  assert_nonempty "reconnect: recovery guidance" "$final_guidance"

  stop_server
  stop_mock_orchestrator "$mock_pid"
  return 0
}

run_confidence_gating() {
  echo "== test: confidence gating thresholds and planning failure states (ADHD-206)"

  if ! bash "$(dirname "$0")/adhd-206-confidence-gating-sweep.sh"; then
    echo "ADHD-206 confidence gating check failed." >&2
    return 1
  fi
}

cleanup() {
  stop_server
  if [[ -n "${MOCK_ORCH_PID:-}" ]] && kill -0 "$MOCK_ORCH_PID" >/dev/null 2>&1; then
    stop_mock_orchestrator "$MOCK_ORCH_PID"
  fi
  rm -f "$SCRIPT_LOG_DIR/adhd-mock-orchestrator.mjs"
  rm -f "$SCRIPT_LOG_DIR/adhd-hardening-cancel.json" "$SCRIPT_LOG_DIR/adhd-hardening-midrun.json" "$SCRIPT_LOG_DIR/adhd-hardening-reconnect.json"
}

trap cleanup EXIT

run_cancellation_startup
run_host_tool_disappears
run_reconnect_reconciliation
run_confidence_gating

echo "All hardening verification checks passed."
