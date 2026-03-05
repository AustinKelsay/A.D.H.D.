# Phase 5 Federation Operator Runbook

## Purpose
Operate multiple host nodes from one control-plane API: register/enroll hosts, heartbeat sync, host-targeted dispatch, and outage reconciliation.

## Prerequisites
- Start federation control plane:
  - `npm run federation-api:start`
- Control-plane endpoint:
  - `http://127.0.0.1:8787`
- Host IDs must match:
  - `^h_[a-z0-9]{6,}$`

## 1) Register Host
```bash
curl -sS -X POST http://127.0.0.1:8787/api/hosts/register \
  -H 'content-type: application/json' \
  -d '{
    "hostId": "h_alpha01",
    "displayName": "alpha-macbook"
  }'
```

Response includes:
- `enrollmentToken`

## 2) Enroll Host (Token Exchange)
```bash
curl -sS -X POST http://127.0.0.1:8787/api/hosts/h_alpha01/enroll \
  -H 'content-type: application/json' \
  -d '{
    "enrollmentToken": "<ENROLLMENT_TOKEN>",
    "capabilities": {
      "codexVersion": "0.3.0",
      "appServer": true,
      "mcp": true,
      "mcpServer": true,
      "features": {
        "multi_agent": {
          "stage": "experimental",
          "enabled": true
        }
      }
    },
    "compatibility": {
      "status": "compatible",
      "checkedAt": "2026-03-05T00:00:00Z",
      "missingMethods": []
    }
  }'
```

Response includes:
- `hostToken` (for heartbeats)

## 3) Send Heartbeat
```bash
curl -sS -X POST http://127.0.0.1:8787/api/hosts/h_alpha01/heartbeat \
  -H "authorization: Bearer <HOST_TOKEN>" \
  -H 'content-type: application/json' \
  -d '{}'
```

## 4) List Hosts
```bash
curl -sS http://127.0.0.1:8787/api/hosts
```

## 5) Create Host-Targeted Job
```bash
curl -sS -X POST http://127.0.0.1:8787/api/jobs \
  -H 'content-type: application/json' \
  -d '{
    "hostId": "h_alpha01",
    "inputText": "Refactor ./src/server/host-api.js and run tests"
  }'
```

## 6) Route Controls To Assigned Host
```bash
curl -sS -X POST http://127.0.0.1:8787/api/jobs/<jobId>/start \
  -H 'content-type: application/json' \
  -d '{}'
```

```bash
curl -sS -X POST http://127.0.0.1:8787/api/jobs/<jobId>/interrupt \
  -H 'content-type: application/json' \
  -d '{}'
```

```bash
curl -sS -X POST http://127.0.0.1:8787/api/jobs/<jobId>/retry \
  -H 'content-type: application/json' \
  -d '{"startNow":true}'
```

## 7) Outage Reconciliation Sweep
```bash
curl -sS -X POST http://127.0.0.1:8787/api/hosts/reconcile \
  -H 'content-type: application/json' \
  -d '{}'
```

## 8) Revoke Host
```bash
curl -sS -X POST http://127.0.0.1:8787/api/hosts/h_alpha01/revoke \
  -H 'content-type: application/json' \
  -d '{}'
```
