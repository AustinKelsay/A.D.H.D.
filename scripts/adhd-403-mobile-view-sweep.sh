#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3027}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3027
fi

SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCHESTRATOR_PORT="${MOCK_ORCHESTRATOR_PORT:-11443}"
SESSION_PERSIST_PATH="$SCRIPT_LOG_DIR/adhd-403-mobile-view-sessions.json"
MOCK_ORCHESTRATOR_LOG_FILE="$SCRIPT_LOG_DIR/adhd-403-mock-orchestrator.log"
MOCK_ORCHESTRATOR_PID_FILE="$SCRIPT_LOG_DIR/adhd-403-mock-orchestrator.pid"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-403-mobile-view-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-403-mobile-view-sweep-server.pid"
MOCK_ORCHESTRATOR_SCRIPT="$SCRIPT_LOG_DIR/adhd-403-mock-orchestrator.mjs"
INDEX_HTML_FILE="$SCRIPT_LOG_DIR/adhd-403-mobile-console.html"

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

assert_not_empty() {
  local label="$1"
  local value="$2"

  if [[ -z "$value" || "$value" == "null" ]]; then
    echo "ASSERTION FAILED [$label]: expected a non-empty value" >&2
    return 1
  fi
  echo "✓ $label: $value"
}

assert_contains() {
  local label="$1"
  local pattern="$2"
  local file_path="$3"

  if ! grep -Fq "$pattern" "$file_path"; then
    echo "ASSERTION FAILED [$label]: missing pattern '$pattern'" >&2
    return 1
  fi
  echo "✓ $label"
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

wait_for_session_state() {
  local session_id="$1"
  local expected_state="$2"
  local timeout_seconds="${3:-20}"
  local n
  local response_file status body state
  SESSION_LAST_STATE=''

  for n in $(seq 1 "$timeout_seconds"); do
    response_file="$(mktemp)"
    status="$(curl -sS -X GET "$BASE_URL/api/sessions/$session_id" \
      -o "$response_file" \
      -w '%{http_code}')"
    if [[ "$status" == "200" ]]; then
      body="$(cat "$response_file")"
      SESSION_STATUS_BODY="$body"
      state="$(printf '%s' "$body" | jq -r '.session.state // empty')"
      SESSION_LAST_STATE="$state"
      if [[ "$state" == "$expected_state" ]]; then
        rm -f "$response_file"
        return 0;
      fi
    fi
    rm -f "$response_file"
    sleep 1
  done

  echo "Session $session_id did not reach state '$expected_state' (last: $state)" >&2
  echo "Session body: ${SESSION_STATUS_BODY:-<no-response>}" >&2
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
  id: 'adhd-403-mock-plan',
  choices: [
    {
      message: {
        content: JSON.stringify({
          profile: 'basic',
          confidence: 0.99,
          requiresConfirmation: false,
          reason: 'mobile view sweep plan',
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
    res.end('{"models":[{"name":"mobile-view-model"}]}');
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

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11443);
server.listen(port, '127.0.0.1', () => {
  console.log(`adhd-403 mock orchestrator listening on ${port}`);
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
  SESSION_ID="$(printf '%s' "$(cat "$response_file")" | jq -r '.session.sessionId // empty')"
  rm -f "$response_file"
}

start_session() {
  local session_id="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/start" \
    -H "Content-Type: application/json" \
    -d '{"command":"bash","args":["-lc","sleep 2"]}' \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_START_STATUS="$status"
  rm -f "$response_file"
}

cancel_session() {
  local session_id="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/cancel" \
    -H "Content-Type: application/json" \
    -d '{}' \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_CANCEL_STATUS="$status"
  rm -f "$response_file"
}

check_frontend_contract() {
  curl -sS "$BASE_URL/" -o "$INDEX_HTML_FILE"

  assert_contains "ADHD-403: responsive media query exists" "@media (max-width: 600px)" "$INDEX_HTML_FILE"
  assert_contains "ADHD-403: active controls are touch-sized" "min-height: 34px" "$INDEX_HTML_FILE"
  assert_contains "ADHD-403: session controls become a grid on mobile" "grid-template-columns: repeat(2, minmax(0, 1fr))" "$INDEX_HTML_FILE"
  assert_contains "ADHD-403: overflow-x prevention is set" "overflow-x: hidden" "$INDEX_HTML_FILE"
  assert_contains "ADHD-403: controls show in-flight state" "Action in progress" "$INDEX_HTML_FILE"
  assert_contains "ADHD-403: cancel actions confirm with user" "window.confirm" "$INDEX_HTML_FILE"
  assert_contains "ADHD-403: completed detail includes output/summary in one-level access" "Details, output, and summary" "$INDEX_HTML_FILE"
  assert_contains "ADHD-403: control actions guard duplicate submits" "controlSnapshots" "$INDEX_HTML_FILE"
  assert_contains "ADHD-403: pending state suppresses repeated controls" "_controlPending" "$INDEX_HTML_FILE"
}

cleanup() {
  if [[ -f "$SERVER_PID_FILE" ]]; then
    stop_if_running "$SERVER_PID_FILE"
  fi
  if [[ -f "$MOCK_ORCHESTRATOR_PID_FILE" ]]; then
    stop_if_running "$MOCK_ORCHESTRATOR_PID_FILE"
  fi
  rm -f "$MOCK_ORCHESTRATOR_SCRIPT"
  rm -f "$INDEX_HTML_FILE"
  rm -f "$SESSION_PERSIST_PATH"
}

trap cleanup EXIT

start_mock_orchestrator
start_server
check_frontend_contract

create_session_intent '{"profile":"basic","taskText":"mobile view sweep session"}'
assert "ADHD-403: create session accepted" "$SESSION_INTENT_STATUS" "201"
assert_not_empty "ADHD-403: session id assigned" "$SESSION_ID"

start_session "$SESSION_ID"
assert "ADHD-403: start action succeeds" "$SESSION_START_STATUS" "200"

wait_for_session_state "$SESSION_ID" "running" "20"
assert "ADHD-403: session reaches running state" "$SESSION_LAST_STATE" "running"

cancel_session "$SESSION_ID"
assert "ADHD-403: cancel action endpoint accepts on desktop UI contract basis" "$SESSION_CANCEL_STATUS" "200"

wait_for_session_state "$SESSION_ID" "cancelled" "20"
assert "ADHD-403: session reaches cancelled state" "$SESSION_LAST_STATE" "cancelled"

echo "ADHD-403 mobile view sweep passed."
