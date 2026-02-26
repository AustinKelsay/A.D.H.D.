#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3024}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3024
fi

SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCHESTRATOR_PORT="${MOCK_ORCHESTRATOR_PORT:-11440}"
SESSION_PERSIST_PATH="$SCRIPT_LOG_DIR/adhd-304-controls-sessions.json"
MOCK_ORCHESTRATOR_LOG_FILE="$SCRIPT_LOG_DIR/adhd-304-mock-orchestrator.log"
MOCK_ORCHESTRATOR_PID_FILE="$SCRIPT_LOG_DIR/adhd-304-mock-orchestrator.pid"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-304-controls-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-304-controls-sweep-server.pid"
MOCK_ORCHESTRATOR_SCRIPT="$SCRIPT_LOG_DIR/adhd-304-mock-orchestrator.mjs"

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

assert_nonempty() {
  local label="$1"
  local value="$2"

  if [[ -z "$value" || "$value" == "null" ]]; then
    echo "ASSERTION FAILED [$label]: expected a non-empty value" >&2
    return 1
  fi
  echo "✓ $label: $value"
}

assert_not_equal() {
  local label="$1"
  local first="$2"
  local second="$3"

  if [[ "$first" == "$second" ]]; then
    echo "ASSERTION FAILED [$label]: expected different values, got '$first'" >&2
    return 1
  fi
  echo "✓ $label: $first != $second"
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
  id: 'adhd-304-mock-plan',
  choices: [
    {
      message: {
        content: JSON.stringify({
          profile: 'basic',
          confidence: 0.99,
          requiresConfirmation: false,
          reason: 'control sweep plan',
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
    res.end('{"models":[{"name":"control-model"}]}');
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

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11440);
server.listen(port, '127.0.0.1', () => {
  console.log(`adhd-304 mock orchestrator listening on ${port}`);
});

setInterval(() => {}, 1000);
MOCK

  MOCK_ORCHESTRATOR_PORT="$MOCK_ORCHESTRATOR_PORT" \
  node "$MOCK_ORCHESTRATOR_SCRIPT" > "$MOCK_ORCHESTRATOR_LOG_FILE" 2>&1 &
  echo "$!" > "$MOCK_ORCHESTRATOR_PID_FILE"
  wait_for_server "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT/api/tags" 12
}

start_server() {
  stop_if_running "$SERVER_PID_FILE"

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

stop_mock_orchestrator() {
  stop_if_running "$MOCK_ORCHESTRATOR_PID_FILE"
}

stop_server() {
  stop_if_running "$SERVER_PID_FILE"
}

create_session_intent() {
  local payload="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/intent" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_INTENT_STATUS="$status"
  SESSION_INTENT_BODY="$(cat "$response_file")"
  SESSION_INTENT_ID="$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.sessionId // empty')"
  rm -f "$response_file"
}

start_session() {
  local session_id="$1"
  local body="$2"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/start" \
    -H "Content-Type: application/json" \
    -d "$body" \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_START_STATUS="$status"
  SESSION_START_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

stop_session() {
  local session_id="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/stop" \
    -H "Content-Type: application/json" \
    -d '{}' \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_STOP_STATUS="$status"
  SESSION_STOP_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

retry_session() {
  local session_id="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/retry" \
    -H "Content-Type: application/json" \
    -d '{}' \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_RETRY_STATUS="$status"
  SESSION_RETRY_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

get_session() {
  local session_id="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X GET "$BASE_URL/api/sessions/$session_id" \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_GET_STATUS="$status"
  SESSION_GET_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

wait_for_session_state() {
  local session_id="$1"
  local expected_state="$2"
  local timeout_seconds="${3:-45}"
  local n

  for n in $(seq 1 "$timeout_seconds"); do
    get_session "$session_id"
    local current_state
    current_state="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.state // empty')"

    if [[ "$current_state" == "$expected_state" ]]; then
      echo "$SESSION_GET_BODY"
      return 0
    fi

    if [[ "$expected_state" == "completed" || "$expected_state" == "failed" || "$expected_state" == "cancelled" ]]; then
      if [[ "$current_state" == "completed" || "$current_state" == "failed" || "$current_state" == "cancelled" ]]; then
        echo "$SESSION_GET_BODY"
        return 1
      fi
    fi

    sleep 1
  done

  echo ""
  return 1
}

cleanup() {
  stop_server
  stop_mock_orchestrator
  rm -f "$MOCK_ORCHESTRATOR_SCRIPT"
  rm -f "$SESSION_PERSIST_PATH"
}

trap cleanup EXIT

start_mock_orchestrator
start_server

create_session_intent '{"profile":"basic","taskText":"control verify cancel path"}'
assert "ADHD-304: cancel scenario intent accepted" "$SESSION_INTENT_STATUS" "201"
CANCEL_SESSION_ID="$SESSION_INTENT_ID"

start_session "$CANCEL_SESSION_ID" '{"command":"bash","args":["-lc","sleep 20"]}'
assert "ADHD-304: cancel scenario start accepted" "$SESSION_START_STATUS" "200"

if ! wait_for_session_state "$CANCEL_SESSION_ID" "running" "20" >/dev/null; then
  echo "Session $CANCEL_SESSION_ID did not enter running state" >&2
  exit 1
fi
assert "ADHD-304: running state before cancel" "$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.state // empty')" "running"

stop_session "$CANCEL_SESSION_ID"
assert "ADHD-304: cancel request accepted" "$SESSION_STOP_STATUS" "200"

if ! wait_for_session_state "$CANCEL_SESSION_ID" "cancelled" "20" >/dev/null; then
  echo "Session $CANCEL_SESSION_ID did not cancel" >&2
  exit 1
fi
assert "ADHD-304: session transitions to cancelled" "$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.state // empty')" "cancelled"

create_session_intent '{"profile":"basic","taskText":"control verify retry path"}'
assert "ADHD-304: failed scenario intent accepted" "$SESSION_INTENT_STATUS" "201"
FAILED_SESSION_ID="$SESSION_INTENT_ID"

start_session "$FAILED_SESSION_ID" '{"command":"bash","args":["-lc","echo should-fail; exit 11"]}'
assert "ADHD-304: failed scenario start accepted" "$SESSION_START_STATUS" "200"

if ! wait_for_session_state "$FAILED_SESSION_ID" "failed" "20" >/dev/null; then
  echo "Session $FAILED_SESSION_ID did not fail" >&2
  exit 1
fi
assert "ADHD-304: session transitions to failed" "$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.state // empty')" "failed"

retry_session "$FAILED_SESSION_ID"
assert "ADHD-304: retry request accepted" "$SESSION_RETRY_STATUS" "201"

RETRIED_SESSION_ID="$(printf '%s' "$SESSION_RETRY_BODY" | jq -r '.session.sessionId // empty')"
assert_nonempty "ADHD-304: retry returns new session id" "$RETRIED_SESSION_ID"
assert_not_equal "ADHD-304: retry creates a different session id" "$RETRIED_SESSION_ID" "$FAILED_SESSION_ID"
RETRY_SESSION_TASK="$(printf '%s' "$SESSION_RETRY_BODY" | jq -r '.session.task // .session.taskIntent.normalizedText // empty')"
assert "ADHD-304: retried task context preserved" "$RETRY_SESSION_TASK" "control verify retry path"

echo "ADHD-304 basic control sweep passed."
