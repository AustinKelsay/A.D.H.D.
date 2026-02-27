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
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-202-routing-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-202-routing-sweep-server.pid"
MANAGED_SERVER=0

if ! command -v curl >/dev/null 2>&1; then
  echo "Required command not found: curl" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Required command not found: jq" >&2
  exit 1
fi

assert_equals() {
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

wait_for_server() {
  for _ in $(seq 1 20); do
    if curl -sS "$BASE_URL/api/sessions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Server did not become reachable at $BASE_URL" >&2
  return 1
}

start_server() {
  PORT="$PORT" bun run start > "$SERVER_LOG_FILE" 2>&1 &
  local server_pid="$!"
  echo "$server_pid" > "$SERVER_PID_FILE"
  MANAGED_SERVER=1

  if ! wait_for_server; then
    echo "Server failed to start" >&2
    return 1
  fi
}

stop_server() {
  if [[ "$MANAGED_SERVER" -ne 1 ]]; then
    return 0
  fi
  if [[ -f "$SERVER_PID_FILE" ]]; then
    local server_pid
    server_pid="$(cat "$SERVER_PID_FILE")"
    if kill -0 "$server_pid" >/dev/null 2>&1; then
      kill -TERM "$server_pid" >/dev/null 2>&1 || true
      wait "$server_pid" 2>/dev/null || true
    fi
    rm -f "$SERVER_PID_FILE"
  fi
}

trap stop_server EXIT

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
  rm -f "$response_file"
}

if ! wait_for_server; then
  start_server
fi

refactor_payload='{"taskText":"Please refactor the authentication flow and rename helper modules."}'
create_session_intent "$refactor_payload"
assert_equals "adhd-202: refactor inferred from task text -> status" "$SESSION_INTENT_STATUS" "201"
assert_equals "adhd-202: refactor profile" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.profile // empty')" "edit"
assert_equals "adhd-202: refactor taskIntent workType" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.taskIntent.workType // empty')" "edit"

open_pr_payload='{"taskIntent":{"workType":"open pr"},"taskText":"Please prepare release notes"}'
create_session_intent "$open_pr_payload"
assert_equals "adhd-202: open pr workType route -> status" "$SESSION_INTENT_STATUS" "201"
assert_equals "adhd-202: open pr profile" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.profile // empty')" "git"
assert_equals "adhd-202: open pr taskIntent workType preserves explicit payload" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.taskIntent.workType // empty')" "open pr"

push_payload='{"taskIntent":{"workType":"push"},"taskText":"Please review this repository and run a quick check."}'
create_session_intent "$push_payload"
assert_equals "adhd-202: push workType route -> status" "$SESSION_INTENT_STATUS" "201"
assert_equals "adhd-202: push profile" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.profile // empty')" "git"
assert_equals "adhd-202: push taskIntent workType" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.session.taskIntent.workType // empty')" "push"

unknown_payload='{"taskIntent":{"workType":"quantum-golf"},"taskText":"Can you clean up this task?"}'
create_session_intent "$unknown_payload"
assert_equals "adhd-202: unknown workType rejected status" "$SESSION_INTENT_STATUS" "400"
assert_equals "adhd-202: unknown workType has invalid-profile category" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.errorCategory // empty')" "invalid-profile"
assert_contains "adhd-202: unknown workType suggestions exposed" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.profileSuggestions | join(",") // empty')" "basic"
assert_contains "adhd-202: unknown workType suggestions exposed" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.profileSuggestions | join(",") // empty')" "edit"
assert_contains "adhd-202: unknown workType returns submitted workType" "$(printf '%s' "$SESSION_INTENT_BODY" | jq -r '.taskIntent.workType // empty')" "quantum golf"

echo "ADHD-202 routing sweep passed."
