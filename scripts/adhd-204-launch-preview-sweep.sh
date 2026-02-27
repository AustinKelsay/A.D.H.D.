#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3010}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3010
fi

SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCHESTRATOR_PORT="${MOCK_ORCHESTRATOR_PORT:-11436}"
MOCK_SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-204-mock-orchestrator.log"
MOCK_SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-204-mock-orchestrator.pid"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-204-launch-preview-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-204-launch-preview-sweep-server.pid"
MOCK_ORCHESTRATOR_SCRIPT="$SCRIPT_LOG_DIR/adhd-204-mock-orchestrator.mjs"

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

assert_true() {
  local label="$1"
  local value="$2"

  if [[ "$value" != "true" ]]; then
    echo "ASSERTION FAILED [$label]: expected true, got '$value'" >&2
    return 1
  fi
  echo "✓ $label: true"
}

wait_for_server() {
  local url="$1"
  local tries="${2:-20}"
  local probe_path="${3:-/api/sessions}"
  local _n
  local normalized_url="${url%/}"
  local normalized_path="$probe_path"
  if [[ "$normalized_path" != /* ]]; then
    normalized_path="/$normalized_path"
  fi

  for _n in $(seq 1 "$tries"); do
    if curl --fail -sS "${normalized_url}${normalized_path}" >/dev/null 2>&1; then
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
    kill -s "$signal" "$pid" >/dev/null 2>&1 || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

start_mock_orchestrator() {
  local port="$1"
  cat > "$MOCK_ORCHESTRATOR_SCRIPT" <<'MOCK'
import http from 'node:http';

const responsePayload = {
  id: 'adhd-204-mock-plan',
  choices: [
    {
      message: {
        content: JSON.stringify({
          profile: 'basic',
          confidence: 0.99,
          requiresConfirmation: false,
          reason: 'mock plan for risky launch preview',
          args: ['--help'],
          selectedProfile: 'basic',
        }),
      },
    },
  ],
};

const server = http.createServer((req, res) => {
  if (req.url === '/api/tags' || req.url === '/models' || req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"models":[{"name":"preview-model"}]}');
    return;
  }

  if (
    req.url === '/chat/completions'
    || req.url === '/api/chat/completions'
    || req.url === '/v1/chat/completions'
  ) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responsePayload));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"error":"not-found"}');
});

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11436);
server.listen(port, '127.0.0.1', () => {
  console.log(`adhd-204 mock orchestrator listening ${port}`);
});

setInterval(() => {}, 1000);
MOCK

  MOCK_ORCHESTRATOR_PORT="$port" node "$MOCK_ORCHESTRATOR_SCRIPT" > "$MOCK_SERVER_LOG_FILE" 2>&1 &
  local pid="$!"
  echo "$pid" > "$MOCK_SERVER_PID_FILE"
  wait_for_server "http://127.0.0.1:$port" 10 '/api/tags'
}

start_server() {
  local managed="$1"
  if [[ "$managed" -eq 1 ]]; then
    PORT="$PORT" \
    ADHD_ORCHESTRATOR_PROVIDER=custom \
    ADHD_ORCHESTRATOR_BASE_URL="http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" \
    ADHD_ORCHESTRATOR_CHAT_PATH="/chat/completions" \
    ADHD_ORCHESTRATOR_MODELS_PATH="/api/tags" \
    bun run start > "$SERVER_LOG_FILE" 2>&1 &
    echo "$!" > "$SERVER_PID_FILE"
  fi
  wait_for_server "$BASE_URL" 25
}

stop_mock_orchestrator() {
  stop_if_running "$MOCK_SERVER_PID_FILE"
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
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_STOP_STATUS="$status"
  SESSION_STOP_BODY="$(cat "$response_file")"
  rm -f "$response_file"
}

check_plan_preview() {
  local label_prefix="$1"
  local body="$2"
  local plan_path=".planPreview"
  assert "$label_prefix status" "$SESSION_START_STATUS" "409"
  assert_true "$label_prefix requiresConfirmation" "$(printf '%s' "$body" | jq -r '.requiresConfirmation // false')"
  assert "$label_prefix state awaiting confirmation" "$(printf '%s' "$body" | jq -r '.session.state // empty')" "awaiting_confirmation"
  assert "$label_prefix profile remains release" "$(printf '%s' "$body" | jq -r "${plan_path}.profile // empty")" "release"
  assert_contains "$label_prefix risk summary is high risk" "$(printf '%s' "$body" | jq -r "${plan_path}.riskSummary // empty")" "High-risk profile"
  assert_true "$label_prefix includes command in plan" "$(printf '%s' "$body" | jq -r "[${plan_path}.command] | first | length > 0")"
  assert_true "$label_prefix includes working directory in plan" "$(printf '%s' "$body" | jq -r "[${plan_path}.workingDirectory] | first | length > 0")"
  assert "$label_prefix session traceability" "$(printf '%s' "$body" | jq -r '.session.sessionId // empty')" "$SESSION_INTENT_ID"
}

cleanup() {
  stop_server
  stop_mock_orchestrator
  rm -f "$MOCK_ORCHESTRATOR_SCRIPT"
}

trap cleanup EXIT

MANAGED_SERVER=0
if ! wait_for_server "$BASE_URL" 10; then
  start_mock_orchestrator "$MOCK_ORCHESTRATOR_PORT"
  if ! wait_for_server "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" 10 '/api/tags'; then
    echo "Mock orchestrator did not start" >&2
    exit 1
  fi
  MANAGED_SERVER=1
  start_server "$MANAGED_SERVER"
fi

release_payload='{"profile":"release","taskText":"Please finalize and push release notes."}'
create_session_intent "$release_payload"
assert "adhd-204: release intent accepted" "$SESSION_INTENT_STATUS" "201"

start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo release-preview"]}'
check_plan_preview "adhd-204: release start preview" "$SESSION_START_BODY"

stop_session "$SESSION_INTENT_ID"
assert "adhd-204: release cancel request status" "$SESSION_STOP_STATUS" "200"
assert "adhd-204: release session cancelled from preview" "$(printf '%s' "$SESSION_STOP_BODY" | jq -r '.session.state // empty')" "cancelled"

highrisk_payload='{"profile":"basic","taskText":"run a risky operation","taskIntent":{"constraints":{"highRisk":true}}}'
create_session_intent "$highrisk_payload"
assert "adhd-204: high-risk basic intent accepted" "$SESSION_INTENT_STATUS" "201"

start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo highrisk-preview"]}'
assert "adhd-204: high-risk basic needs confirmation" "$SESSION_START_STATUS" "409"
assert_true "adhd-204: high-risk explicit requires confirmation" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.requiresConfirmation // false')"
assert_contains "adhd-204: explicit high-risk includes risk summary" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.planPreview.riskSummary // empty')" "Requires confirmation before launch"

create_session_intent "$highrisk_payload"
assert "adhd-204: high-risk confirmation session accepted" "$SESSION_INTENT_STATUS" "201"
start_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo confirm"],"confirm":true}'
assert "adhd-204: confirmed session starts or runs" "$SESSION_START_STATUS" "200"
assert "adhd-204: confirmation ok" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.ok // empty')" "true"
assert_contains "adhd-204: confirmation returns sessionId traceability" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.session.sessionId // empty')" "$SESSION_INTENT_ID"
assert_true "adhd-204: confirmation enters active state" "$(printf '%s' "$SESSION_START_BODY" | jq -r '(.session.state == "starting" or .session.state == "running")')"

echo "ADHD-204 launch preview sweep passed."
