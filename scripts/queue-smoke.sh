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

MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-30}"
SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-queue-smoke-server.log"

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

create_intent() {
  local label="$1"
  local payload response_file
  payload="$(jq -nc --arg l "$label" '{"profile":"basic","taskText":$l}')" || return 1

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

  echo "$session_id"
}

start_session() {
  local session_id="$1"
  local response_file response status
  response_file="$(mktemp)"

  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/start" \
    -H "Content-Type: application/json" \
    -d '{"command":"bash","args":["-lc","sleep 20"]}' \
    -o "$response_file" \
    -w '%{http_code}' \
    )"

  cat "$response_file"
  echo "___STATUS___$status"

  rm -f "$response_file"
}

start_server() {
  local policy="$1"
  local pid_file="$2"

  ADHD_MAX_CONCURRENT_SESSIONS=1 \
  ADHD_START_QUEUE_POLICY="$policy" \
  PORT="$PORT" \
  bun run start > "$SERVER_LOG_FILE" 2>&1 &

  local server_pid="$!"
  echo "$server_pid" > "$pid_file"

  for _ in $(seq 1 "$MAX_WAIT_SECONDS"); do
    if curl -sS "$BASE_URL/api/sessions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Server failed to start for policy '$policy'. Last log output:" >&2
  tail -n 80 "$SERVER_LOG_FILE" >&2 || true
  return 1
}

stop_server() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" || true
      wait "$pid" 2>/dev/null || true
    fi
  fi
}

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

assert_json_bool() {
  local label="$1"
  local value="$2"
  local expected="$3"

  if [[ "$value" != "$expected" ]]; then
    echo "ASSERTION FAILED [$label]: expected '$expected', got '$value'" >&2
    return 1
  fi
  echo "✓ $label: $value"
}

run_mode_queue() {
  local policy="queue"
  local pid_file="$SCRIPT_LOG_DIR/adhd-queue-smoke-$policy.pid"
  echo "== policy: $policy"

  if ! start_server "$policy" "$pid_file"; then
    return 1
  fi

  local first second
  first="$(create_intent "queue-smoke first")" || return 1
  second="$(create_intent "queue-smoke second")" || return 1

  local first_resp first_status
  first_resp="$(start_session "$first")" || return 1
  first_status="${first_resp##*___STATUS___}"
  first_resp="${first_resp%___STATUS___*}"

  assert "queue mode: first start status" "$first_status" "200" || return 1

  local second_resp second_status second_queued second_queue_policy
  second_resp="$(start_session "$second")" || return 1
  second_status="${second_resp##*___STATUS___}"
  second_resp="${second_resp%___STATUS___*}"

  assert "queue mode: second start status" "$second_status" "200" || return 1
  second_queued="$(printf '%s\n' "$second_resp" | jq -r '.queued // empty')"
  assert_json_bool "queue mode: second start was queued" "$second_queued" "true"
  second_queue_policy="$(printf '%s\n' "$second_resp" | jq -r '.queueStatus.policy // empty')"
  assert "queue mode: queueStatus.policy" "$second_queue_policy" "queue" || return 1

  stop_server "$pid_file"
  rm -f "$pid_file"
  return 0
}

run_mode_reject() {
  local policy="reject"
  local pid_file="$SCRIPT_LOG_DIR/adhd-queue-smoke-$policy.pid"
  echo "== policy: $policy"

  if ! start_server "$policy" "$pid_file"; then
    return 1
  fi

  local first second
  first="$(create_intent "reject-smoke first")"
  second="$(create_intent "reject-smoke second")"

  local first_resp first_status
  first_resp="$(start_session "$first")" || return 1
  first_status="${first_resp##*___STATUS___}"
  first_resp="${first_resp%___STATUS___*}"
  assert "reject mode: first start status" "$first_status" "200" || return 1

  local second_resp second_status second_code second_blocked second_policy
  second_resp="$(start_session "$second")" || return 1
  second_status="${second_resp##*___STATUS___}"
  second_resp="${second_resp%___STATUS___*}"

  assert "reject mode: second start status" "$second_status" "429" || return 1
  second_code="$(printf '%s\n' "$second_resp" | jq -r '.errorCode // empty')"
  assert "reject mode: errorCode" "$second_code" "RUNNER_QUEUE_FULL" || return 1
  second_blocked="$(printf '%s\n' "$second_resp" | jq -r '.queueBlocked // empty')"
  assert_json_bool "reject mode: queueBlocked" "$second_blocked" "true"
  second_policy="$(printf '%s\n' "$second_resp" | jq -r '.queueStatus.policy // empty')"
  assert "reject mode: queueStatus.policy" "$second_policy" "reject" || return 1

  stop_server "$pid_file"
  rm -f "$pid_file"
  return 0
}

cleanup() {
  local files
  files=("$SCRIPT_LOG_DIR/adhd-queue-smoke-queue.pid" "$SCRIPT_LOG_DIR/adhd-queue-smoke-reject.pid")
  for f in "${files[@]}"; do
    stop_server "$f"
    rm -f "$f"
  done
}

trap cleanup EXIT

run_mode_queue
run_mode_reject

echo "All queue-mode smoke checks passed."
