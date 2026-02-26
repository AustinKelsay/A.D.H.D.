#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3022}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3022
fi

SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCHESTRATOR_PORT="${MOCK_ORCHESTRATOR_PORT:-11437}"
MOCK_ORCHESTRATOR_LOG_FILE="$SCRIPT_LOG_DIR/adhd-206-mock-orchestrator.log"
MOCK_ORCHESTRATOR_PID_FILE="$SCRIPT_LOG_DIR/adhd-206-mock-orchestrator.pid"
MOCK_ORCHESTRATOR_SCRIPT="$SCRIPT_LOG_DIR/adhd-mock-orchestrator.mjs"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-206-confidence-gating-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-206-confidence-gating-sweep-server.pid"

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

stop_mock_orchestrator() {
  stop_if_running "$MOCK_ORCHESTRATOR_PID_FILE"
}

start_mock_orchestrator() {
  local scenario="$1"

  cat > "$MOCK_ORCHESTRATOR_SCRIPT" <<'MOCK'
import http from 'node:http';

const scenario = String(process.env.MOCK_SCENARIO || 'basic_auto').trim().toLowerCase();

const plans = {
  basic_auto: {
    profile: 'basic',
    confidence: 0.88,
    requiresConfirmation: false,
    reason: 'basic high-confidence plan for confidence gating',
    args: ['--help'],
    selectedProfile: 'basic',
  },
  git_confidence: {
    profile: 'git',
    confidence: 0.92,
    requiresConfirmation: false,
    reason: 'git plan that should still require confirmation',
    args: ['status'],
    selectedProfile: 'git',
  },
  release_confidence: {
    profile: 'release',
    confidence: 0.99,
    requiresConfirmation: false,
    reason: 'release plan is always manual',
    args: ['status'],
    selectedProfile: 'release',
  },
  missing_confidence: {
    profile: 'basic',
    reason: 'missing confidence payload should be blocked',
    args: ['--help'],
    selectedProfile: 'basic',
  },
};

const plan = plans[scenario] || plans.basic_auto;
const responseBody = {
  id: `adhd-206-mock-${scenario}`,
  choices: [
    {
      message: {
        content: JSON.stringify(plan),
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
    res.end('{"models":[{"name":"gating-model"}]}');
    return;
  }

  if (req.url === '/chat/completions' || req.url === '/api/chat/completions' || req.url === '/v1/chat/completions') {
    const payload = JSON.stringify(responseBody);
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

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11437);
server.listen(port, '127.0.0.1', () => {
  console.log(`adhd-206 mock orchestrator listening on ${port} scenario=${scenario}`);
});

setInterval(() => {}, 1000);
MOCK

  MOCK_SCENARIO="$scenario" \
  MOCK_ORCHESTRATOR_PORT="$MOCK_ORCHESTRATOR_PORT" \
  node "$MOCK_ORCHESTRATOR_SCRIPT" > "$MOCK_ORCHESTRATOR_LOG_FILE" 2>&1 &
  local pid="$!"
  echo "$pid" > "$MOCK_ORCHESTRATOR_PID_FILE"
  wait_for_server "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" 12
}

start_server() {
  stop_if_running "$SERVER_PID_FILE"

  ADHD_ORCHESTRATOR_PROVIDER=custom \
  ADHD_ORCHESTRATOR_BASE_URL="http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" \
  ADHD_ORCHESTRATOR_CHAT_PATH="/chat/completions" \
  ADHD_ORCHESTRATOR_MODELS_PATH="/api/tags" \
  ADHD_START_QUEUE_POLICY=queue \
  ADHD_MAX_CONCURRENT_SESSIONS=0 \
  PORT="$PORT" \
  bun run start > "$SERVER_LOG_FILE" 2>&1 &
  echo "$!" > "$SERVER_PID_FILE"
  wait_for_server "$BASE_URL" 25
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

cleanup() {
  stop_server
  stop_mock_orchestrator
  rm -f "$MOCK_ORCHESTRATOR_SCRIPT"
}

trap cleanup EXIT

start_mock_orchestrator basic_auto
start_server

start_mock_orchestrator basic_auto
create_session_intent '{"profile":"basic","taskText":"lint files quickly"}'
assert "adhd-206: basic intent accepted" "$SESSION_INTENT_STATUS" "201"
start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["--help"]}'
assert "adhd-206: basic high-confidence auto-path status" "$SESSION_START_STATUS" "200"
assert_true "adhd-206: basic high-confidence not blocked by confirmation" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.ok // false')"
assert_contains "adhd-206: basic high-confidence returns queued or running" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.queued // false')" "true"
assert "adhd-206: basic high-confidence state stays queued" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.session.state // empty')" "queued"

stop_mock_orchestrator
start_mock_orchestrator git_confidence
create_session_intent '{"profile":"git","taskText":"commit and push changes"}'
assert "adhd-206: git intent accepted" "$SESSION_INTENT_STATUS" "201"
start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo git-scenario"]}'
assert "adhd-206: git 0.92 status requires confirmation" "$SESSION_START_STATUS" "409"
assert_true "adhd-206: git scenario requires confirmation" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.requiresConfirmation // false')"
assert "adhd-206: git scenario goes awaiting confirmation" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.session.state // empty')" "awaiting_confirmation"

stop_mock_orchestrator
start_mock_orchestrator release_confidence
create_session_intent '{"profile":"release","taskText":"prepare release bundle"}'
assert "adhd-206: release intent accepted" "$SESSION_INTENT_STATUS" "201"
start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo release-scenario"]}'
assert "adhd-206: release status requires confirmation" "$SESSION_START_STATUS" "409"
assert_true "adhd-206: release scenario requires confirmation" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.requiresConfirmation // false')"
assert "adhd-206: release goes awaiting confirmation" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.session.state // empty')" "awaiting_confirmation"

stop_mock_orchestrator
start_mock_orchestrator missing_confidence
create_session_intent '{"profile":"basic","taskText":"run with missing confidence"}'
assert "adhd-206: missing confidence intent accepted" "$SESSION_INTENT_STATUS" "201"
start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo missing-confidence"]}'
assert "adhd-206: missing confidence status" "$SESSION_START_STATUS" "500"
assert "adhd-206: missing confidence error code" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.errorCode // empty')" "blocked-planning-failed"
assert "adhd-206: missing confidence moves to failed" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.session.state // empty')" "failed"
assert "adhd-206: missing confidence has planner failure category" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.errorCategory // empty')" "orchestrator-invalid-plan"
assert_true "adhd-206: missing confidence provides recovery guidance" "$(printf '%s' "$SESSION_START_BODY" | jq -r '(.recoveryGuidance | length > 0) // false')"

echo "ADHD-206 confidence gating sweep passed."
