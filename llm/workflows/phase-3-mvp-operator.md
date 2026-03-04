# Phase 3 MVP Operator Runbook

## Purpose
Quick operational commands for single-host MVP flows: intake, live controls, pagination/filtering, and results.

## Prerequisites
- Start host API:
  - `npm run host-api:start`
- Default local endpoint:
  - `http://127.0.0.1:8787`

## 1) Unified Intake

### Text intake
```bash
curl -sS -X POST http://127.0.0.1:8787/api/intake \
  -H 'content-type: application/json' \
  -d '{
    "inputText": "Refactor ./src/server/host-api.js and run tests"
  }'
```

### Voice intake (transcript)
```bash
curl -sS -X POST http://127.0.0.1:8787/api/intake \
  -H 'content-type: application/json' \
  -d '{
    "intake": {
      "mode": "voice",
      "transcript": "Fix bug in ./src/runtime/host-runtime.js",
      "source": "microphone",
      "language": "en-US"
    }
  }'
```

### Voice intake (ASR segments only)
```bash
curl -sS -X POST http://127.0.0.1:8787/api/intake \
  -H 'content-type: application/json' \
  -d '{
    "intake": {
      "source": "asr-provider",
      "segments": [
        {"text": "Refactor"},
        {"alternatives": [{"transcript": "./src/server/host-api.js"}]},
        "carefully"
      ]
    }
  }'
```

### Auto-start on intake
```bash
curl -sS -X POST http://127.0.0.1:8787/api/intake \
  -H 'content-type: application/json' \
  -d '{
    "inputText": "Implement feature X",
    "autoStart": true
  }'
```

## 2) Job Listing With Pagination/Filtering

### Basic list
```bash
curl -sS 'http://127.0.0.1:8787/api/jobs'
```

### Filter by state
```bash
curl -sS 'http://127.0.0.1:8787/api/jobs?state=running'
```

### Filter by delegation mode
```bash
curl -sS 'http://127.0.0.1:8787/api/jobs?delegationMode=fallback_workers'
```

### Text query + pagination
```bash
curl -sS 'http://127.0.0.1:8787/api/jobs?q=bug&limit=20&offset=0'
```

## 3) Live Controls

### Poll live state + pending approvals
```bash
curl -sS 'http://127.0.0.1:8787/api/jobs/<jobId>/live'
```

### Interrupt
```bash
curl -sS -X POST http://127.0.0.1:8787/api/jobs/<jobId>/interrupt -d '{}'
```

### Retry
```bash
curl -sS -X POST http://127.0.0.1:8787/api/jobs/<jobId>/retry -d '{}'
```

### Retry + start immediately
```bash
curl -sS -X POST http://127.0.0.1:8787/api/jobs/<jobId>/retry \
  -H 'content-type: application/json' \
  -d '{"startNow": true}'
```

## 4) Results

### Get summary and artifacts
```bash
curl -sS 'http://127.0.0.1:8787/api/jobs/<jobId>/result'
```

## Notes
- Pagination response includes `pagination.total`, `pagination.limit`, `pagination.offset`, `pagination.returned`, and `pagination.hasMore`.
- Intake response/job metadata includes normalized `intake` with `mode`, `source`, `language`, and `segmentCount`.
