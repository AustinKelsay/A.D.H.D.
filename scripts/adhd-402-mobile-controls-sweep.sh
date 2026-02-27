#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3026}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3026
  BASE_URL="http://127.0.0.1:3026"
fi

SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCHESTRATOR_PORT="${MOCK_ORCHESTRATOR_PORT:-11442}"
SESSION_PERSIST_PATH="$SCRIPT_LOG_DIR/adhd-402-sessions.json"
MOCK_ORCHESTRATOR_LOG_FILE="$SCRIPT_LOG_DIR/adhd-402-mock-orchestrator.log"
MOCK_ORCHESTRATOR_PID_FILE="$SCRIPT_LOG_DIR/adhd-402-mock-orchestrator.pid"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-402-mobile-controls-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-402-mobile-controls-server.pid"
MOCK_ORCHESTRATOR_SCRIPT="$SCRIPT_LOG_DIR/adhd-402-mock-orchestrator.mjs"

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

assert_true() {
  local label="$1"
  local actual="$2"

  if [[ "$actual" != "true" ]]; then
    echo "ASSERTION FAILED [$label]: expected true, got '$actual'" >&2
    return 1
  fi
  echo "✓ $label: true"
}

assert_not_empty() {
  local label="$1"
  local value="$2"

  if [[ -z "$value" || "$value" == "null" ]]; then
    echo "ASSERTION FAILED [$label]: expected a non-empty value" >&2
    return 1
  fi
  echo "✓ $label: $value"
}

wait_for_server() {
  local url="$1"
  local tries="${2:-20}"
  local n
  for n in $(seq 1 "$tries"); do
    if curl -sS "$url/api/sessions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Server did not become reachable at $url" >&2
  return 1
}

stop_if_running() {
  local pid_file="$1"
  local signal="${2:-TERM}"

  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$signal" "$pid" >/dev/null 2>&1 || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

start_mock_orchestrator() {
  cat > "$MOCK_ORCHESTRATOR_SCRIPT" <<'MOCK'
import http from 'node:http';

const response = {
  id: 'adhd-402-mock-plan',
  choices: [
    {
      message: {
        content: JSON.stringify({
          profile: 'basic',
          confidence: 0.99,
          requiresConfirmation: false,
          reason: 'mobile controls sweep plan',
          args: ['--help'],
          selectedProfile: 'basic',
        }),
      },
    },
  ],
};

const server = http.createServer((req, res) => {
  if (
    req.url === '/api/tags'
    || req.url === '/models'
    || req.url === '/v1/models'
  ) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"models":[{"name":"mobile-sweep-model"}]}');
    return;
  }

  if (
    req.url === '/chat/completions'
    || req.url === '/api/chat/completions'
    || req.url === '/v1/chat/completions'
  ) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(response)),
    });
    res.end(JSON.stringify(response));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"error":"not-found"}');
});

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11442);
server.listen(port, '127.0.0.1', () => {
  console.log(`adhd-402 mock orchestrator listening on ${port}`);
});

setInterval(() => {}, 1000);
MOCK

  MOCK_ORCHESTRATOR_PORT="$MOCK_ORCHESTRATOR_PORT" \
  node "$MOCK_ORCHESTRATOR_SCRIPT" > "$MOCK_ORCHESTRATOR_LOG_FILE" 2>&1 &
  echo "$!" > "$MOCK_ORCHESTRATOR_PID_FILE"
  wait_for_server "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT/api/tags" 12
}

start_server() {
  ADHD_ORCHESTRATOR_PROVIDER=custom \
  ADHD_ORCHESTRATOR_BASE_URL="http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" \
  ADHD_ORCHESTRATOR_CHAT_PATH="/chat/completions" \
  ADHD_ORCHESTRATOR_MODELS_PATH="/api/tags" \
  ADHD_SESSION_PERSIST_PATH="$SESSION_PERSIST_PATH" \
  PORT="$PORT" \
  bun run start > "$SERVER_LOG_FILE" 2>&1 &
  echo "$!" > "$SERVER_PID_FILE"
  wait_for_server "$BASE_URL" 20
}

pair_with_host() {
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/pair/request" \
    -H 'Content-Type: application/json' \
    -d '{}' \
    -o "$response_file" \
    -w '%{http_code}')"
  PAIR_TOKEN="$(cat "$response_file" | jq -r '.token // empty')"
  rm -f "$response_file"

  if [[ -z "$PAIR_TOKEN" || "$PAIR_TOKEN" == "null" ]]; then
    echo "Pairing token not returned" >&2
    return 1
  fi

  AUTH_HEADER="${PAIR_TOKEN}"
  assert "ADHD-402: pair request accepted" "$status" "201"
}

mobile_auth_header() {
  echo "x-adhd-api-token: $AUTH_HEADER"
}

create_session_intent() {
  local payload="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/intent" \
    -H "Content-Type: application/json" \
    -H "$(mobile_auth_header)" \
    -d "$payload" \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_INTENT_STATUS="$status"
  SESSION_INTENT_BODY="$(cat "$response_file")"
  SESSION_ID="$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.sessionId // empty')"
  rm -f "$response_file"
}

list_mobile_sessions() {
  local response_file
  response_file="$(mktemp)"
  curl -sS "$BASE_URL/api/mobile/sessions" \
    -H "$(mobile_auth_header)" \
    -o "$response_file"
  MOBILE_LIST_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

mobile_start() {
  local session_id="$1"
  local action_id="$2"
  local payload="$3"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/mobile/sessions/$session_id/start" \
    -H "Content-Type: application/json" \
    -H "$(mobile_auth_header)" \
    -H "x-adhd-action-id: $action_id" \
    -d "$payload" \
    -o "$response_file" \
    -w '%{http_code}')"
  MOBILE_START_STATUS="$status"
  MOBILE_START_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

mobile_cancel() {
  local session_id="$1"
  local action_id="$2"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/mobile/sessions/$session_id/cancel" \
    -H "Content-Type: application/json" \
    -H "$(mobile_auth_header)" \
    -H "x-adhd-action-id: $action_id" \
    -d '{}' \
    -o "$response_file" \
    -w '%{http_code}')"
  MOBILE_CANCEL_STATUS="$status"
  MOBILE_CANCEL_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

mobile_retry() {
  local session_id="$1"
  local action_id="$2"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/mobile/sessions/$session_id/retry" \
    -H "Content-Type: application/json" \
    -H "$(mobile_auth_header)" \
    -H "x-adhd-action-id: $action_id" \
    -d '{}' \
    -o "$response_file" \
    -w '%{http_code}')"
  MOBILE_RETRY_STATUS="$status"
  MOBILE_RETRY_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

mobile_rerun() {
  local session_id="$1"
  local action_id="$2"
  local payload="${3:-'{}'}"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/mobile/sessions/$session_id/rerun" \
    -H "Content-Type: application/json" \
    -H "$(mobile_auth_header)" \
    -H "x-adhd-action-id: $action_id" \
    -d "$payload" \
    -o "$response_file" \
    -w '%{http_code}')"
  MOBILE_RERUN_STATUS="$status"
  MOBILE_RERUN_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

get_mobile_session() {
  local session_id="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X GET "$BASE_URL/api/mobile/sessions/$session_id" \
    -H "$(mobile_auth_header)" \
    -o "$response_file" \
    -w '%{http_code}')"
  MOBILE_SESSION_STATUS="$status"
  MOBILE_SESSION_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

wait_for_state() {
  local session_id="$1"
  local expected_state="$2"
  local timeout_seconds="${3:-30}"
  local n

  for n in $(seq 1 "$timeout_seconds"); do
    get_mobile_session "$session_id"
    local state
    state="$(printf '%s' "$MOBILE_SESSION_BODY" | jq -r '.session.state // empty')"
    if [[ "$state" == "$expected_state" ]]; then
      echo "$MOBILE_SESSION_BODY"
      return 0
    fi
    sleep 1
  done

  echo "Session $session_id did not reach expected state: $expected_state (last: $state)" >&2
  return 1
}

cleanup() {
  if [[ -f "$SERVER_PID_FILE" ]]; then
    stop_if_running "$SERVER_PID_FILE"
  fi
  if [[ -f "$MOCK_ORCHESTRATOR_PID_FILE" ]]; then
    stop_if_running "$MOCK_ORCHESTRATOR_PID_FILE"
  fi
  rm -f "$MOCK_ORCHESTRATOR_SCRIPT"
  rm -f "$SESSION_PERSIST_PATH"
}

trap cleanup EXIT

start_mock_orchestrator
start_server
pair_with_host

create_session_intent '{"profile":"basic","taskText":"mobile mobile list and actions check"}'
assert "ADHD-402: create session with pair auth" "$SESSION_INTENT_STATUS" "201"
assert_not_empty "ADHD-402: session id created" "$SESSION_ID"

list_mobile_sessions
assert "ADHD-402: mobile list accessible" "$(printf '%s' "$MOBILE_LIST_BODY" | jq -r 'has("sessions")')" "true"
assert_true "ADHD-402: mobile list contains at least one progress field" "$(printf '%s' "$MOBILE_LIST_BODY" | jq -r '.sessions | map(has("progress")) | any')"

mobile_start "$SESSION_ID" "start-1" '{"command":"bash","args":["-lc","sleep 2"]}'
assert "ADHD-402: mobile start request accepted" "$MOBILE_START_STATUS" "200"
assert "ADHD-402: mobile start response includes projected session" "$(printf '%s' "$MOBILE_START_BODY" | jq -r 'has("session")')" "true"

wait_for_state "$SESSION_ID" "running" "20"
assert "ADHD-402: session becomes running" "$(printf '%s' "$MOBILE_SESSION_BODY" | jq -r '.session.state // empty')" "running"

mobile_cancel "$SESSION_ID" "cancel-1"
assert "ADHD-402: mobile cancel request accepted" "$MOBILE_CANCEL_STATUS" "200"
assert "ADHD-402: session state transitions cancelled" "$(printf '%s' "$MOBILE_CANCEL_BODY" | jq -r '.session.state // empty')" "cancelled"

mobile_rerun "$SESSION_ID" "rerun-1" '{}'
assert "ADHD-402: mobile rerun accepted" "$MOBILE_RERUN_STATUS" "201"
MOBILE_RERUN_SESSION_ID="$(printf '%s' "$MOBILE_RERUN_BODY" | jq -r '.session.sessionId // empty')"
assert_not_empty "ADHD-402: rerun creates new session" "$MOBILE_RERUN_SESSION_ID"

mobile_rerun "$SESSION_ID" "rerun-1" '{}'
assert "ADHD-402: duplicate rerun is idempotent" "$MOBILE_RERUN_STATUS" "201"
MOBILE_RERUN_SESSION_ID_DUP="$(printf '%s' "$MOBILE_RERUN_BODY" | jq -r '.session.sessionId // empty')"
assert "ADHD-402: duplicate rerun returns same session id" "$MOBILE_RERUN_SESSION_ID_DUP" "$MOBILE_RERUN_SESSION_ID"

create_session_intent '{"profile":"basic","taskText":"mobile retry action target"}'
assert "ADHD-402: create failed-session input" "$SESSION_INTENT_STATUS" "201"
FAILED_SESSION_ID="$SESSION_ID"

mobile_start "$FAILED_SESSION_ID" "start-fail-1" '{"command":"bash","args":["-lc","exit 11"]}'
assert "ADHD-402: failed session start request accepted" "$MOBILE_START_STATUS" "200"

if ! wait_for_state "$FAILED_SESSION_ID" "failed" "20" >/dev/null; then
  echo "Failed mobile session did not fail" >&2
  exit 1
fi
assert "ADHD-402: failed session state is failed" "$(printf '%s' "$MOBILE_SESSION_BODY" | jq -r '.session.state // empty')" "failed"

mobile_retry "$FAILED_SESSION_ID" "retry-1"
assert "ADHD-402: mobile retry accepted" "$MOBILE_RETRY_STATUS" "201"
MOBILE_RETRY_SESSION_ID="$(printf '%s' "$MOBILE_RETRY_BODY" | jq -r '.session.sessionId // empty')"
assert_not_empty "ADHD-402: retry creates new session" "$MOBILE_RETRY_SESSION_ID"

mobile_retry "$FAILED_SESSION_ID" "retry-1"
assert "ADHD-402: duplicate retry is idempotent" "$MOBILE_RETRY_STATUS" "201"
MOBILE_RETRY_SESSION_ID_DUP="$(printf '%s' "$MOBILE_RETRY_BODY" | jq -r '.session.sessionId // empty')"
assert "ADHD-402: duplicate retry returns same session id" "$MOBILE_RETRY_SESSION_ID_DUP" "$MOBILE_RETRY_SESSION_ID"

echo "ADHD-402 mobile controls sweep passed."
