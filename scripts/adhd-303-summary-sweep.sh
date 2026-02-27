#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3023}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3023
fi

SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCHESTRATOR_PORT="${MOCK_ORCHESTRATOR_PORT:-11438}"
SESSION_PERSIST_PATH="$SCRIPT_LOG_DIR/adhd-303-summary-sweep-sessions.json"

MOCK_ORCHESTRATOR_LOG_FILE="$SCRIPT_LOG_DIR/adhd-303-mock-orchestrator.log"
MOCK_ORCHESTRATOR_PID_FILE="$SCRIPT_LOG_DIR/adhd-303-mock-orchestrator.pid"
MOCK_ORCHESTRATOR_SCRIPT="$(mktemp "$SCRIPT_LOG_DIR/adhd-303-mock-orchestrator-XXXXXX.mjs")"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-303-summary-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-303-summary-sweep-server.pid"

if ! command -v curl >/dev/null 2>&1; then
  echo "Required command not found: curl" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Required command not found: jq" >&2
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
  local value="$2"

  if [[ "$value" != "true" ]]; then
    echo "ASSERTION FAILED [$label]: expected true, got '$value'" >&2
    return 1
  fi
  echo "✓ $label: true"
}

assert_contains() {
  local label="$1"
  local haystack="$2"
  local needle="$3"

  if [[ "$haystack" != *"$needle"* ]]; then
    echo "ASSERTION FAILED [$label]: expected '$needle' in '$haystack'" >&2
    return 1
  fi

  echo "✓ $label: contains '$needle'"
}

assert_nonempty() {
  local label="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    echo "ASSERTION FAILED [$label]: expected non-empty value" >&2
    return 1
  fi
  echo "✓ $label: $value"
}

assert_file_exists() {
  local label="$1"
  local value="$2"

  if [[ ! -f "$value" ]]; then
    echo "ASSERTION FAILED [$label]: expected file to exist at '$value'" >&2
    return 1
  fi
  echo "✓ $label: $value"
}

assert_json_number_gte_zero_or_equal() {
  local label="$1"
  local value="$2"
  local n="$3"

  if ! [[ "$value" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "ASSERTION FAILED [$label]: expected numeric value, got '$value'" >&2
    return 1
  fi

  awk -v actual="$value" -v threshold="$n" 'BEGIN { exit !(actual >= threshold) }' \
    || {
      echo "ASSERTION FAILED [$label]: expected >= $n, got '$value'" >&2
      return 1
    }
  echo "✓ $label: $value"
}

assert_file_contains() {
  local label="$1"
  local path="$2"
  local needle="$3"

  if [[ ! -f "$path" ]] || ! grep -qF "$needle" "$path"; then
    echo "ASSERTION FAILED [$label]: expected '$needle' in '$path'" >&2
    return 1
  fi
  echo "✓ $label: contains '$needle'"
}

wait_for_server() {
  local url="$1"
  local tries="${2:-20}"
  local probe="${3:-/api/sessions}"
  local n
  local base_url="${url%/}"
  local probe_url="$probe"

  if [[ "$probe" != http://* && "$probe" != https://* ]]; then
    if [[ "$probe" != /* ]]; then
      probe="/$probe"
    fi
    probe_url="${base_url}${probe}"
  fi

  for n in $(seq 1 "$tries"); do
    if curl --fail -sS "$probe_url" >/dev/null 2>&1; then
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

stop_mock_orchestrator() {
  stop_if_running "$MOCK_ORCHESTRATOR_PID_FILE"
}

start_mock_orchestrator() {
  cat > "$MOCK_ORCHESTRATOR_SCRIPT" <<'MOCK'
import http from 'node:http';

const response = {
  id: 'adhd-303-mock-plan',
  choices: [
    {
      message: {
        content: JSON.stringify({
          profile: 'basic',
          confidence: 0.99,
          requiresConfirmation: false,
          reason: 'summary sweep plan',
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
    res.end('{"models":[{"name":"summary-model"}]}');
    return;
  }

  if (req.url === '/chat/completions' || req.url === '/api/chat/completions' || req.url === '/v1/chat/completions') {
    const payload = JSON.stringify(response);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"error":"not-found"}');
});

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11438);
server.listen(port, '127.0.0.1', () => {
  console.log(`adhd-303 mock orchestrator listening on ${port}`);
});

setInterval(() => {}, 1000);
MOCK

  MOCK_ORCHESTRATOR_PORT="$MOCK_ORCHESTRATOR_PORT" \
  node "$MOCK_ORCHESTRATOR_SCRIPT" > "$MOCK_ORCHESTRATOR_LOG_FILE" 2>&1 &
  echo "$!" > "$MOCK_ORCHESTRATOR_PID_FILE"
  wait_for_server "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" 12 '/api/tags'
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

wait_for_terminal_state() {
  local session_id="$1"
  local timeout_seconds="${2:-45}"
  local n state status

  for n in $(seq 1 "$timeout_seconds"); do
    get_session "$session_id"
    state="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.state // empty')"
    if [[ "$state" == "completed" || "$state" == "failed" || "$state" == "cancelled" ]]; then
      return 0
    fi
    sleep 1
  done

  echo "Session $session_id did not reach terminal state (last status ${SESSION_GET_STATUS})" >&2
  return 1
}

assert_catalog_contains_session() {
  local label="$1"
  local session_id="$2"
  local timeout_seconds="${3:-10}"
  local n

  if [[ ! -f "$SESSION_PERSIST_PATH" ]]; then
    echo "ASSERTION FAILED [$label]: persist file missing at '$SESSION_PERSIST_PATH'" >&2
    return 1
  fi

  for n in $(seq 1 "$timeout_seconds"); do
    if jq -e --arg sid "$session_id" 'map(select(.sessionId == $sid)) | length > 0' "$SESSION_PERSIST_PATH" >/dev/null 2>&1; then
      echo "✓ $label"
      return 0
    fi
    sleep 1
  done

  echo "ASSERTION FAILED [$label]: session '$session_id' not found in persist file" >&2
  return 1;
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

create_session_intent '{"profile":"basic","taskText":"summary persistence completes successfully"}'
COMPLETE_SESSION_ID="$SESSION_INTENT_ID"
assert "ADHD-303: completed scenario intent accepted" "$SESSION_INTENT_STATUS" "201"
start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo summary-pass-output"]}'
assert "ADHD-303: completed start accepted" "$SESSION_START_STATUS" "200"
if ! wait_for_terminal_state "$SESSION_INTENT_ID" 60; then
  echo "Session $SESSION_INTENT_ID did not complete" >&2
  exit 1
fi

COMPLETE_SESSION_STATE="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.state // empty')"
assert "ADHD-303: completed scenario ends terminal" "$COMPLETE_SESSION_STATE" "completed"

COMPLETE_SUMMARY_DURATION="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.durationMs // empty')"
assert_json_number_gte_zero_or_equal "ADHD-303: completed summary duration is non-negative" "$COMPLETE_SUMMARY_DURATION" 0

COMPLETE_SUMMARY_EXIT="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.exitCode // empty')"
assert "ADHD-303: completed summary exit code" "$COMPLETE_SUMMARY_EXIT" "0"

COMPLETE_SUMMARY_TRANSCRIPT="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.transcript // empty')"
assert_contains "ADHD-303: completed summary has transcript" "$COMPLETE_SUMMARY_TRANSCRIPT" "summary-pass-output"

COMPLETE_SUMMARY_OUTPUT_PATH="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.outputPath // empty')"
assert_nonempty "ADHD-303: completed summary output path exists" "$COMPLETE_SUMMARY_OUTPUT_PATH"
assert_file_exists "ADHD-303: completed transcript artifact exists" "$COMPLETE_SUMMARY_OUTPUT_PATH"
assert_file_contains "ADHD-303: completed output artifact includes expected text" "$COMPLETE_SUMMARY_OUTPUT_PATH" "summary-pass-output"

COMPLETE_RUNTIME_EXIT="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.runtime.exitCode // empty')"
assert "ADHD-303: completed summary exit matches runtime" "$COMPLETE_SUMMARY_EXIT" "$COMPLETE_RUNTIME_EXIT"

COMPLETE_SUMMARY_FAILED="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.failed // false')"
assert "ADHD-303: completed summary is not marked failed" "$COMPLETE_SUMMARY_FAILED" "false"

create_session_intent '{"profile":"basic","taskText":"summary persistence records failures"}'
assert "ADHD-303: failed intent accepted" "$SESSION_INTENT_STATUS" "201"
start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo should-fail; exit 11"]}'
assert "ADHD-303: failed start accepted" "$SESSION_START_STATUS" "200"
if ! wait_for_terminal_state "$SESSION_INTENT_ID" 60; then
  echo "Session $SESSION_INTENT_ID did not fail" >&2
  exit 1
fi

FAIL_SESSION_STATE="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.state // empty')"
assert "ADHD-303: failed scenario ends failed" "$FAIL_SESSION_STATE" "failed"

FAIL_SUMMARY_EXIT="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.exitCode // empty')"
assert "ADHD-303: failed summary exit code" "$FAIL_SUMMARY_EXIT" "11"
FAIL_SUMMARY_FAILED="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.failed // false')"
assert_true "ADHD-303: failed summary is marked failed" "$(printf '%s' "$FAIL_SUMMARY_FAILED")"

FAIL_SUMMARY_CATEGORY="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.errorCategory // empty')"
assert_nonempty "ADHD-303: failed summary includes error category" "$FAIL_SUMMARY_CATEGORY"

FAIL_SUMMARY_OUTPUT_PATH="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.summary.outputPath // empty')"
assert_nonempty "ADHD-303: failed summary output path exists" "$FAIL_SUMMARY_OUTPUT_PATH"
assert_file_exists "ADHD-303: failed transcript artifact exists" "$FAIL_SUMMARY_OUTPUT_PATH"
assert_file_contains "ADHD-303: failed output artifact includes expected text" "$FAIL_SUMMARY_OUTPUT_PATH" "should-fail"

FAIL_RUNTIME_EXIT="$(printf '%s' "$SESSION_GET_BODY" | jq -r '.session.runtime.exitCode // empty')"
assert "ADHD-303: failed summary exit matches runtime" "$FAIL_SUMMARY_EXIT" "$FAIL_RUNTIME_EXIT"

FAILED_SESSION_ID="$SESSION_INTENT_ID"

assert_catalog_contains_session "ADHD-303: completed session persists in catalog" "$COMPLETE_SESSION_ID"
assert_catalog_contains_session "ADHD-303: failed session persists in catalog" "$FAILED_SESSION_ID"

echo "ADHD-303 summary persistence sweep passed."
