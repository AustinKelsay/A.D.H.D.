#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3028}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3028
  BASE_URL="http://127.0.0.1:3028"
fi

SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCHESTRATOR_PORT="${MOCK_ORCHESTRATOR_PORT:-11444}"
SESSION_PERSIST_PATH="$SCRIPT_LOG_DIR/adhd-404-cross-device-actions-sessions.json"
MOCK_ORCHESTRATOR_LOG_FILE="$SCRIPT_LOG_DIR/adhd-404-mock-orchestrator.log"
MOCK_ORCHESTRATOR_PID_FILE="$SCRIPT_LOG_DIR/adhd-404-mock-orchestrator.pid"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-404-cross-device-action-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-404-cross-device-action-sweep-server.pid"
MOCK_ORCHESTRATOR_SCRIPT="$SCRIPT_LOG_DIR/adhd-404-mock-orchestrator.mjs"
API_CONNECT_TIMEOUT="${API_CONNECT_TIMEOUT:-2}"
API_MAX_TIME="${API_MAX_TIME:-8}"
ACTION_TIMEOUT_SECONDS="${ACTION_TIMEOUT_SECONDS:-15}"

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

assert_key_match() {
  local label="$1"
  local body_a="$2"
  local body_b="$3"
  local keys_a
  local keys_b

  keys_a="$(printf '%s' "$body_a" | jq -c 'keys | sort')"
  keys_b="$(printf '%s' "$body_b" | jq -c 'keys | sort')"

  if [[ "$keys_a" != "$keys_b" ]]; then
    echo "ASSERTION FAILED [$label]: key mismatch '$keys_a' vs '$keys_b'" >&2
    return 1
  fi
  echo "✓ $label: $keys_a"
}

run_curl() {
  local method="$1"
  local url="$2"
  local output_file="$3"
  shift 3

  local status

  status="$(curl --connect-timeout "$API_CONNECT_TIMEOUT" --max-time "$API_MAX_TIME" \
    -sS -X "$method" "$@" "$url" \
    -o "$output_file" -w '%{http_code}' || true)"

  if [[ -z "$status" ]]; then
    status="000"
  fi

  echo "$status"
}

wait_for_background_actions() {
  local timeout_seconds="$1"
  shift
  local pids=("$@")
  local pid start=$SECONDS

  while ((SECONDS - start < timeout_seconds)); do
    local running_count=0
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        running_count=$((running_count + 1))
      fi
    done

    if ((running_count == 0)); then
      return 0
    fi

    sleep 1
  done

  echo "Timed out after ${timeout_seconds}s waiting on background actions: ${pids[*]}" >&2
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done

  return 1
}

extract_response_parts() {
  local file="$1"
  local status_var="$2"
  local body_var="$3"
  local status
  local body

  status="$(sed -n '1p' "$file")"
  body="$(sed -n '2,$p' "$file")"

  printf -v "$status_var" '%s' "$status"
  printf -v "$body_var" '%s' "$body"
}

wait_for_server() {
  local url="$1"
  local tries="${2:-20}"
  local path="${3:-/api/sessions}"
  local n

  for n in $(seq 1 "$tries"); do
    local response_file
    response_file="$(mktemp)"
    if [[ "$(run_curl GET "${url%/}$path" "$response_file")" == "200" ]]; then
      rm -f "$response_file"
      return 0
    fi
    rm -f "$response_file"
    sleep 1
  done

  echo "Server did not become reachable at $url" >&2
  return 1
}

wait_for_state() {
  local session_id="$1"
  local expected_state="$2"
  local timeout_seconds="${3:-30}"
  local n
  local response_file status body state

  for n in $(seq 1 "$timeout_seconds"); do
    response_file="$(mktemp)"
    status="$(run_curl GET "$BASE_URL/api/sessions/$session_id" "$response_file")"

    if [[ "$status" == "200" ]]; then
      body="$(cat "$response_file")"
      state="$(printf '%s' "$body" | jq -r '.session.state // empty')"
      if [[ "$state" == "$expected_state" ]]; then
        rm -f "$response_file"
        return 0
      fi
    fi

    rm -f "$response_file"
    sleep 1
  done

  echo "Session $session_id did not reach expected state '$expected_state' (last: $state)" >&2
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
  id: 'adhd-404-mock-plan',
  choices: [
    {
      message: {
        content: JSON.stringify({
          profile: 'basic',
          confidence: 0.99,
          requiresConfirmation: false,
          reason: 'cross-device action sweep plan',
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
    res.end('{"models":[{"name":"mobile-cross-device-model"}]}');
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

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11444);
server.listen(port, '127.0.0.1', () => {
  console.log(`adhd-404 mock orchestrator listening on ${port}`);
});

setInterval(() => {}, 1000);
MOCK

  MOCK_ORCHESTRATOR_PORT="$MOCK_ORCHESTRATOR_PORT" \
  node "$MOCK_ORCHESTRATOR_SCRIPT" > "$MOCK_ORCHESTRATOR_LOG_FILE" 2>&1 &
  echo "$!" > "$MOCK_ORCHESTRATOR_PID_FILE"
  wait_for_server "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" 12 /api/tags
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

pair_with_host() {
  local response_file status
  response_file="$(mktemp)"
  status="$(run_curl POST "$BASE_URL/api/pair/request" \
    "$response_file" \
    -H 'Content-Type: application/json' \
    -d '{}' \
  )"

  AUTH_TOKEN="$(cat "$response_file" | jq -r '.token // empty')"
  rm -f "$response_file"

  assert "ADHD-404: pair request accepted" "$status" "201"
  assert_not_empty "ADHD-404: pair token issued" "$AUTH_TOKEN"
}

mobile_auth_header() {
  echo "x-adhd-api-token: $AUTH_TOKEN"
}

create_session_intent() {
  local payload="$1"
  local response_file status
  response_file="$(mktemp)"
  status="$(run_curl POST "$BASE_URL/api/sessions/intent" \
    "$response_file" \
    -H 'Content-Type: application/json' \
    -d "$payload" \
  )"

  SESSION_INTENT_BODY="$(cat "$response_file")"
  SESSION_ID="$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.sessionId // empty')"
  rm -f "$response_file"

  assert "ADHD-404: session intent accepted" "$status" "201"
  assert_not_empty "ADHD-404: session id created" "$SESSION_ID"
}

desktop_start_session() {
  local session_id="$1"
  local command_payload="$2"
  local response_file
  local status

  response_file="$(mktemp)"
  status="$(run_curl POST "$BASE_URL/api/sessions/$session_id/start" \
    "$response_file" \
    -H 'Content-Type: application/json' \
    -d "$command_payload" \
  )"

  rm -f "$response_file"
  assert "ADHD-404: desktop start accepted" "$status" "200"
}

desktop_stop_session() {
  local session_id="$1"
  local out_file="$2"
  local response_file
  local status

  response_file="$(mktemp)"
  status="$(run_curl POST "$BASE_URL/api/sessions/$session_id/stop" \
    "$response_file" \
    -H 'Content-Type: application/json' \
    -d '{}' \
  )"

  {
    echo "$status"
    cat "$response_file"
  } > "$out_file"
  rm -f "$response_file"
}

mobile_cancel_session() {
  local session_id="$1"
  local out_file="$2"
  local action_id="$3"
  local response_file
  local status

  response_file="$(mktemp)"
  status="$(run_curl POST "$BASE_URL/api/mobile/sessions/$session_id/cancel" \
    "$response_file" \
    -H 'Content-Type: application/json' \
    -H "x-adhd-action-id: $action_id" \
    -H "$(mobile_auth_header)" \
    -d '{}' \
  )"

  {
    echo "$status"
    cat "$response_file"
  } > "$out_file"
  rm -f "$response_file"
}

desktop_retry_session() {
  local session_id="$1"
  local out_file="$2"
  local response_file
  local status

  response_file="$(mktemp)"
  status="$(run_curl POST "$BASE_URL/api/sessions/$session_id/retry" \
    "$response_file" \
    -H 'Content-Type: application/json' \
    -d '{}' \
  )"

  {
    echo "$status"
    cat "$response_file"
  } > "$out_file"
  rm -f "$response_file"
}

mobile_retry_session() {
  local session_id="$1"
  local out_file="$2"
  local action_id="$3"
  local response_file
  local status

  response_file="$(mktemp)"
  status="$(run_curl POST "$BASE_URL/api/mobile/sessions/$session_id/retry" \
    "$response_file" \
    -H 'Content-Type: application/json' \
    -H "x-adhd-action-id: $action_id" \
    -H "$(mobile_auth_header)" \
    -d '{}' \
  )"

  {
    echo "$status"
    cat "$response_file"
  } > "$out_file"
  rm -f "$response_file"
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

# Parity for cancellation from desktop stop and mobile cancel on same session
create_session_intent '{"profile":"basic","taskText":"adhd-404 desktop-vs-mobile cancel parity"}'
CANCEL_SESSION_ID="$SESSION_ID"
desktop_start_session "$CANCEL_SESSION_ID" '{"command":"bash","args":["-lc","sleep 12"]}'
wait_for_state "$CANCEL_SESSION_ID" "running" 30

DESKTOP_CANCEL_FILE="$(mktemp)"
MOBILE_CANCEL_FILE="$(mktemp)"

desktop_stop_session "$CANCEL_SESSION_ID" "$DESKTOP_CANCEL_FILE" &
DESKTOP_CANCEL_PID=$!
mobile_cancel_session "$CANCEL_SESSION_ID" "$MOBILE_CANCEL_FILE" "cancel-adhd-404" &
MOBILE_CANCEL_PID=$!
wait_for_background_actions "$ACTION_TIMEOUT_SECONDS" "$DESKTOP_CANCEL_PID" "$MOBILE_CANCEL_PID"

extract_response_parts "$DESKTOP_CANCEL_FILE" DESKTOP_CANCEL_STATUS DESKTOP_CANCEL_BODY
extract_response_parts "$MOBILE_CANCEL_FILE" MOBILE_CANCEL_STATUS MOBILE_CANCEL_BODY
rm -f "$DESKTOP_CANCEL_FILE" "$MOBILE_CANCEL_FILE"

assert "ADHD-404: desktop cancel accepted" "$DESKTOP_CANCEL_STATUS" "200"
assert "ADHD-404: mobile cancel accepted" "$MOBILE_CANCEL_STATUS" "200"
assert "ADHD-404: desktop cancel payload has ok" "$(printf '%s' "$DESKTOP_CANCEL_BODY" | jq -r '.ok // empty')" "true"
assert "ADHD-404: mobile cancel payload has ok" "$(printf '%s' "$MOBILE_CANCEL_BODY" | jq -r '.ok // empty')" "true"
assert "ADHD-404: desktop cancel sets cancelled" "$(printf '%s' "$DESKTOP_CANCEL_BODY" | jq -r '.session.state // empty')" "cancelled"
assert "ADHD-404: mobile cancel sets cancelled" "$(printf '%s' "$MOBILE_CANCEL_BODY" | jq -r '.session.state // empty')" "cancelled"
assert_key_match "ADHD-404: cancel response key shape is identical" "$DESKTOP_CANCEL_BODY" "$MOBILE_CANCEL_BODY"
assert_key_match "ADHD-404: cancel response session key shape is identical" "$(printf '%s' "$DESKTOP_CANCEL_BODY" | jq -c '.session | keys | sort')" "$(printf '%s' "$MOBILE_CANCEL_BODY" | jq -c '.session | keys | sort')"

# Retry race: parallel desktop and mobile retry should return canonical session id
create_session_intent '{"profile":"basic","taskText":"adhd-404 retry race parity"}'
FAILED_SESSION_ID="$SESSION_ID"
desktop_start_session "$FAILED_SESSION_ID" '{"command":"bash","args":["-lc","exit 11"]}'
wait_for_state "$FAILED_SESSION_ID" "failed" 30

DESKTOP_RETRY_FILE="$(mktemp)"
MOBILE_RETRY_FILE="$(mktemp)"

desktop_retry_session "$FAILED_SESSION_ID" "$DESKTOP_RETRY_FILE" &
DESKTOP_RETRY_PID=$!
mobile_retry_session "$FAILED_SESSION_ID" "$MOBILE_RETRY_FILE" "retry-adhd-404" &
MOBILE_RETRY_PID=$!
wait_for_background_actions "$ACTION_TIMEOUT_SECONDS" "$DESKTOP_RETRY_PID" "$MOBILE_RETRY_PID"

extract_response_parts "$DESKTOP_RETRY_FILE" DESKTOP_RETRY_STATUS DESKTOP_RETRY_BODY
extract_response_parts "$MOBILE_RETRY_FILE" MOBILE_RETRY_STATUS MOBILE_RETRY_BODY
rm -f "$DESKTOP_RETRY_FILE" "$MOBILE_RETRY_FILE"

assert "ADHD-404: desktop retry accepted" "$DESKTOP_RETRY_STATUS" "201"
assert "ADHD-404: mobile retry accepted" "$MOBILE_RETRY_STATUS" "201"

DESKTOP_RETRY_SESSION_ID="$(printf '%s' "$DESKTOP_RETRY_BODY" | jq -r '.session.sessionId // empty')"
MOBILE_RETRY_SESSION_ID="$(printf '%s' "$MOBILE_RETRY_BODY" | jq -r '.session.sessionId // empty')"

assert_not_empty "ADHD-404: desktop retry returns session id" "$DESKTOP_RETRY_SESSION_ID"
assert_not_empty "ADHD-404: mobile retry returns session id" "$MOBILE_RETRY_SESSION_ID"
assert "ADHD-404: parallel retry converges to canonical session" "$MOBILE_RETRY_SESSION_ID" "$DESKTOP_RETRY_SESSION_ID"
assert_key_match "ADHD-404: retry response key shape is identical" "$DESKTOP_RETRY_BODY" "$MOBILE_RETRY_BODY"

echo "ADHD-404 cross-device action semantics sweep passed."
