#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3010}"
HOST_PORT="${BASE_URL#*://}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"
if [[ "$HOST" == "$PORT" ]]; then
  PORT=3010
  BASE_URL="http://127.0.0.1:3010"
fi

SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-201-contract-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-201-contract-sweep-server.pid"

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

start_server() {
  PORT="$PORT" bun run start > "$SERVER_LOG_FILE" 2>&1 &
  local server_pid="$!"
  echo "$server_pid" > "$SERVER_PID_FILE"

  for _ in $(seq 1 20); do
    if curl -sS "$BASE_URL/api/sessions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Server failed to start" >&2
  return 1
}

stop_server() {
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

create_session_intent() {
  local payload="$1"
  curl -sS -X POST "$BASE_URL/api/sessions/intent" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

start_server
trap 'stop_server' EXIT

punctuated_payload='{"profile":"basic","taskText":"Please, fix bug!!! (quickly)."}'
payload_output=$(create_session_intent "$punctuated_payload")
assert "adhd-201: request succeeded" "$(printf '%s' "$payload_output" | jq -r '.ok')" "true"
raw_text=$(printf '%s' "$payload_output" | jq -r '.session.taskIntent.rawText // empty')
normalized_text=$(printf '%s' "$payload_output" | jq -r '.session.taskIntent.normalizedText // empty')
assert "adhd-201: raw text preserved" "$raw_text" "Please, fix bug!!! (quickly)."
assert "adhd-201: deterministic normalized text" "$normalized_text" "Please fix bug quickly"

ambiguous_payload='{"profile":"basic","taskText":"open /Users/plebdev/src and /tmp/project"}'
ambiguous_output=$(create_session_intent "$ambiguous_payload")
assert "adhd-201: ambiguous intent accepted" "$(printf '%s' "$ambiguous_output" | jq -r '.ok')" "true"
assert_true "adhd-201: ambiguous path defaulted" "$(printf '%s' "$ambiguous_output" | jq -r '.session.taskIntent.constraints.targetAmbiguous // false')"
assert "adhd-201: ambiguous target default workspace" "$(printf '%s' "$ambiguous_output" | jq -r '.session.taskIntent.target // empty')" "$(printf '%s' "$ambiguous_output" | jq -r '.session.workingDirectory // empty')"

constraints_payload='{"profile":"basic","taskText":"Refactor login handler","taskIntent":{"constraints":{"highRisk":true,"priority":"critical"}}}'
constraints_output=$(create_session_intent "$constraints_payload")
assert "adhd-201: explicit constraints preserved" "$(printf '%s' "$constraints_output" | jq -r '.session.taskIntent.constraints.highRisk // false')" "true"
assert "adhd-201: explicit constraints keep custom key" "$(printf '%s' "$constraints_output" | jq -r '.session.taskIntent.constraints.priority // empty')" "critical"

stop_server
trap - EXIT

echo "ADHD-201 contract sweep passed."
