#!/usr/bin/env bash

set -euo pipefail

APP_PORT="${APP_PORT:-3020}"
BASE_URL="${BASE_URL:-http://127.0.0.1:$APP_PORT}"
MOCK_ORCHESTRATOR_PORT="${MOCK_ORCHESTRATOR_PORT:-11436}"
SCRIPT_LOG_DIR="${TMPDIR:-/tmp}"
MOCK_ORCHESTRATOR_LOG_FILE="$SCRIPT_LOG_DIR/adhd-205-mock-orchestrator.log"
MOCK_ORCHESTRATOR_PID_FILE="$SCRIPT_LOG_DIR/adhd-205-mock-orchestrator.pid"
MOCK_ORCHESTRATOR_SCRIPT="$(mktemp "$SCRIPT_LOG_DIR/adhd-205-mock-orchestrator.XXXXXX.mjs")"
MOCK_ORCHESTRATOR_REQUEST_LOG="$(mktemp "$SCRIPT_LOG_DIR/adhd-205-mock-orchestrator.requests.XXXXXX.jsonl")"
SERVER_LOG_FILE="$SCRIPT_LOG_DIR/adhd-205-adapter-sweep-server.log"
SERVER_PID_FILE="$SCRIPT_LOG_DIR/adhd-205-adapter-sweep-server.pid"

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
  local tries="${2:-25}"
  local endpoint="${3:-/api/sessions}"
  local _
  for _ in $(seq 1 "$tries"); do
    if curl -sS "${url%/}${endpoint}" >/dev/null 2>&1; then
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
  local delay_ms="${2:-0}"

  stop_mock_orchestrator
  rm -f "$MOCK_ORCHESTRATOR_REQUEST_LOG"
  cat > "$MOCK_ORCHESTRATOR_SCRIPT" <<'MOCK'
import fs from 'node:fs';
import http from 'node:http';

const scenario = String(process.env.MOCK_SCENARIO || 'valid').trim().toLowerCase();
const delayMs = Number(process.env.MOCK_DELAY_MS || 0);
const requestLogPath = String(process.env.MOCK_REQUEST_LOG || '').trim();
let requestIndex = 0;

function writeLog(record) {
  if (!requestLogPath) return;
  requestIndex += 1;
  const payload = {
    ...record,
    requestIndex,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(requestLogPath, `${JSON.stringify(payload)}\n`);
}

const validResponse = {
  id: 'adhd-205-mock-plan',
  choices: [
    {
      message: {
        content: JSON.stringify({
          profile: 'basic',
          confidence: 0.99,
          requiresConfirmation: false,
          reason: 'mock plan for provider adapter sweep',
          args: ['--help'],
          selectedProfile: 'basic',
        }),
      },
    },
  ],
};

function sendValid(res) {
  const payload = JSON.stringify(validResponse);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendMalformed(res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': 12,
  });
  res.end('not-json-here');
}

const server = http.createServer(async (req, res) => {
  const isPlanRoute = req.url === '/api/chat'
    || req.url === '/chat/completions'
    || req.url === '/v1/chat/completions'
    || req.url === '/api/v1/chat/completions';

  if (!isPlanRoute || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not-found"}');
    return;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const requestBody = Buffer.concat(chunks).toString('utf8');
  const response = {
    method: req.method,
    url: req.url,
    host: req.headers.host || '',
    headers: {
      authorization: req.headers.authorization || '',
      referer: req.headers['http-referer'] || req.headers.referer || '',
      xTitle: req.headers['x-title'] || '',
    },
    body: requestBody,
  };

  let parsedBody = null;
  try {
    parsedBody = requestBody ? JSON.parse(requestBody) : null;
  } catch {
    parsedBody = null;
  }
  writeLog({ ...response, parsedBody });

  const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : 0;
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
  }

  if (scenario === 'malformed') {
    sendMalformed(res);
    return;
  }

  sendValid(res);
});

const port = Number(process.env.MOCK_ORCHESTRATOR_PORT || 11445);
  server.listen(port, '127.0.0.1', () => {
    console.log(`adhd-205 mock orchestrator listening ${port} (${scenario})`);
  });
MOCK

  MOCK_SCENARIO="$scenario" \
  MOCK_DELAY_MS="$delay_ms" \
  MOCK_REQUEST_LOG="$MOCK_ORCHESTRATOR_REQUEST_LOG" \
  MOCK_ORCHESTRATOR_PORT="$MOCK_ORCHESTRATOR_PORT" \
  node "$MOCK_ORCHESTRATOR_SCRIPT" > "$MOCK_ORCHESTRATOR_LOG_FILE" 2>&1 &
  local pid="$!"
  echo "$pid" > "$MOCK_ORCHESTRATOR_PID_FILE"
  wait_for_server "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" 20 '/'
}

start_server() {
  local provider="$1"
  local base_url="$2"
  local model="$3"
  local api_key="${4:-}"
  local referer="${5:-}"
  local title="${6:-}"
  local timeout_ms="${7:-15000}"
  local chat_path="${8:-}"

  stop_server
  if [[ -n "$chat_path" ]]; then
    ADHD_ORCHESTRATOR_CHAT_PATH="$chat_path"
  fi
  ADHD_ORCHESTRATOR_PROVIDER="$provider" \
  ADHD_ORCHESTRATOR_BASE_URL="$base_url" \
  ADHD_ORCHESTRATOR_MODEL="$model" \
  ADHD_ORCHESTRATOR_TIMEOUT_MS="$timeout_ms" \
  ADHD_ORCHESTRATOR_API_KEY="$api_key" \
  ADHD_OPENROUTER_REFERER="$referer" \
  ADHD_OPENROUTER_TITLE="$title" \
  PORT="$APP_PORT" \
  bun run start > "$SERVER_LOG_FILE" 2>&1 &
  echo "$!" > "$SERVER_PID_FILE"
  wait_for_server "$BASE_URL" 25
}

stop_server() {
  stop_if_running "$SERVER_PID_FILE"
}

cleanup() {
  stop_server
  stop_mock_orchestrator
  rm -f "$MOCK_ORCHESTRATOR_SCRIPT"
  rm -f "$MOCK_ORCHESTRATOR_REQUEST_LOG"
}

trap cleanup EXIT

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

preview_session() {
  local session_id="$1"
  local body="$2"
  local response_file status
  response_file="$(mktemp)"
  status="$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/preview" \
    -H "Content-Type: application/json" \
    -d "$body" \
    -o "$response_file" \
    -w '%{http_code}')"
  SESSION_PREVIEW_STATUS="$status"
  SESSION_PREVIEW_BODY="$(cat "$response_file")"
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

read_request_body_field() {
  local request_index="$1"
  local field="$2"
  jq -s -r ".[${request_index}] | ${field} // empty" "$MOCK_ORCHESTRATOR_REQUEST_LOG"
}

read_request_count() {
  jq -s 'length' "$MOCK_ORCHESTRATOR_REQUEST_LOG" 2>/dev/null || echo 0
}

start_mock_orchestrator valid
start_server ollama "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" llama3.1

# Case: Ollama default profile uses local base URL and default model.
create_session_intent '{"profile":"basic","taskText":"run a local planning check"}'
assert "ADHD-205: ollama intent accepted" "$SESSION_INTENT_STATUS" "201"

preview_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo adapter-ollama"]}'
assert "ADHD-205: ollama preview call success" "$SESSION_PREVIEW_STATUS" "200"
assert "ADHD-205: ollama request host points to local mock" "$(read_request_body_field 0 '.host // empty')" "127.0.0.1:$MOCK_ORCHESTRATOR_PORT"
assert "ADHD-205: ollama request path uses local plan endpoint" "$(read_request_body_field 0 '.url // empty')" "/api/chat"
assert "ADHD-205: ollama uses default local model" "$(read_request_body_field 0 '.parsedBody.model // empty')" "llama3.1"

# Recycle server with openrouter configuration.
stop_server
start_server openrouter "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" "openrouter/test-model" "openrouter-token" "https://example.local" "ADHD Adapter Test"

create_session_intent '{"profile":"basic","taskText":"check openrouter plan path and auth headers"}'
assert "ADHD-205: openrouter intent accepted" "$SESSION_INTENT_STATUS" "201"

preview_session "$SESSION_INTENT_ID" '{"command":"bash","args":["-lc","echo adapter-openrouter"]}'
assert "ADHD-205: openrouter preview call success" "$SESSION_PREVIEW_STATUS" "200"
assert "ADHD-205: openrouter hits configured model endpoint" "$(read_request_body_field 1 '.url // empty')" "/v1/chat/completions"
assert "ADHD-205: openrouter uses configured model" "$(read_request_body_field 1 '.parsedBody.model // empty')" "openrouter/test-model"
assert "ADHD-205: openrouter passes authorization header" "$(read_request_body_field 1 '.headers.authorization // empty')" "Bearer openrouter-token"
assert "ADHD-205: openrouter passes referer header" "$(read_request_body_field 1 '.headers.referer // empty')" "https://example.local"
assert "ADHD-205: openrouter passes title header" "$(read_request_body_field 1 '.headers.xTitle // empty')" "ADHD Adapter Test"

# Recycle for malformed planning response case.
stop_server
start_mock_orchestrator malformed
start_server custom "http://127.0.0.1:$MOCK_ORCHESTRATOR_PORT" "adapter-custom-model"

create_session_intent '{"profile":"basic","taskText":"malformed plan should fail"}'
assert "ADHD-205: malformed scenario intent accepted" "$SESSION_INTENT_STATUS" "201"

start_session "$SESSION_INTENT_ID" '{"confirm":true,"command":"bash","args":["-lc","echo should-not-run"]}'
assert "ADHD-205: malformed response fails planning" "$SESSION_START_STATUS" "500"
assert "ADHD-205: malformed response fails into failed category" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.errorCategory // empty')" "orchestrator-invalid-plan"
assert_true "ADHD-205: malformed response returns remediation guidance" "$([[ -n "$(printf '%s' "$SESSION_START_BODY" | jq -r '.recoveryGuidance // empty')" ]] && echo true || echo false)"
assert "ADHD-205: malformed response fails with failed planning state" "$(printf '%s' "$SESSION_START_BODY" | jq -r '.session.state // empty')" "failed"
assert "ADHD-205: malformed request was sent once" "$(read_request_count)" "1"

echo "ADHD-205 provider adapter sweep passed."
