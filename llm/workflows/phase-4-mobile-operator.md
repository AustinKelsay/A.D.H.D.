# Phase 4 Mobile Operator Runbook

## Purpose
Quick commands for pairing a phone client, authenticating mobile actions, and recovering events after reconnect.

## Prerequisites
- Start host API:
  - `npm run host-api:start`
- Endpoint:
  - `http://127.0.0.1:8787`

## 1) Start Pairing
```bash
curl -sS -X POST http://127.0.0.1:8787/api/mobile/pairing/start \
  -H 'content-type: application/json' \
  -d '{"deviceLabel":"pixel-operator"}'
```

Expected response includes:
- `pairing.pairingCode`
- `pairing.expiresAt`

## 2) Complete Pairing (Get Bearer Token)
```bash
curl -sS -X POST http://127.0.0.1:8787/api/mobile/pairing/complete \
  -H 'content-type: application/json' \
  -d '{"pairingCode":"<PAIRING_CODE>","deviceLabel":"pixel-operator"}'
```

Expected response includes:
- `token`
- `session`

## 3) Validate Session
```bash
curl -sS http://127.0.0.1:8787/api/mobile/session \
  -H 'authorization: Bearer <TOKEN>'
```

## 4) Run Mobile-Parity Job Actions

### Create job via mobile route
```bash
curl -sS -X POST http://127.0.0.1:8787/api/mobile/jobs \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <TOKEN>' \
  -d '{"inputText":"Refactor ./src/server/host-api.js"}'
```

### Start job
```bash
curl -sS -X POST http://127.0.0.1:8787/api/mobile/jobs/<jobId>/start \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <TOKEN>' \
  -d '{}'
```

### Interrupt job
```bash
curl -sS -X POST http://127.0.0.1:8787/api/mobile/jobs/<jobId>/interrupt \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <TOKEN>' \
  -d '{}'
```

### Retry (optional startNow)
```bash
curl -sS -X POST http://127.0.0.1:8787/api/mobile/jobs/<jobId>/retry \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <TOKEN>' \
  -d '{"startNow":true}'
```

## 5) Reconnect-Safe Event Replay

### Poll events from cursor
```bash
curl -sS 'http://127.0.0.1:8787/api/mobile/events?after=0&limit=50' \
  -H 'authorization: Bearer <TOKEN>'
```

Use returned `nextAfterId` as the next `after` value after reconnect.

### SSE stream with cursor resume
```bash
curl -N 'http://127.0.0.1:8787/api/mobile/events/stream?after=<lastSeenId>' \
  -H 'authorization: Bearer <TOKEN>'
```

## 6) Revoke Session
```bash
curl -sS -X POST http://127.0.0.1:8787/api/mobile/session/revoke \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <TOKEN>' \
  -d '{}'
```
