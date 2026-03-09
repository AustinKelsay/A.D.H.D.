# Phase 12 Runbook: Desktop Client Operator Flow

## Goal
Use the ADHD desktop shell as the primary desktop operator surface for local job creation, control, approvals, and result review.

## Scope
- desktop intake and job views
- desktop control actions
- approval handling
- local backend inspection through the desktop shell

## 0. Verify Phase 12 Baseline
```bash
npm run phase12:verify
```

Expected:
- docs lint passes
- Tauri shell scaffold check passes
- desktop shell frontend builds
- desktop shell tests pass
- Rust/Tauri side compiles

## 1. Start Local Backend
From repo root:

```bash
npm run local:up
```

If Codex startup is slow:

```bash
ADHD_RPC_REQUEST_TIMEOUT_MS=120000 npm run local:up
```

Expected:
- host API is healthy on `http://127.0.0.1:8787/health`
- federation API is healthy on `http://127.0.0.1:8788/health`

## 2. Launch The Desktop Client
Browser shell:

```bash
npm run shell:web
```

Native Tauri shell:

```bash
npm run shell:dev
```

Expected initial UI:
- host readiness card
- federation readiness card
- create-job panel
- hosts panel
- recent jobs panel
- selected job detail panel

## 3. Create A Job
In the desktop client:
- select a target host
- enter intake text
- leave `Start immediately after create` enabled when you want immediate dispatch

Equivalent backend call:

```bash
curl -sS -X POST http://127.0.0.1:8788/api/jobs \
  -H 'content-type: application/json' \
  -d '{
    "hostId": "h_alpha01",
    "inputText": "Summarize ./src/server and identify the key control-plane modules"
  }'
```

Expected:
- new job appears in the recent jobs list
- detail pane auto-selects the newest visible job

## 4. Operate A Job
Available desktop actions:
- `Start`
- `Interrupt`
- `Retry`
- `Retry + Start`
- `Refresh`

Equivalent federation routes:
- `POST /api/jobs/<jobId>/start`
- `POST /api/jobs/<jobId>/interrupt`
- `POST /api/jobs/<jobId>/retry`

Expected:
- action banner reflects the operation outcome
- detail panel refreshes the selected job state
- jobs list reflects the latest timestamp/state ordering

## 5. Handle Approvals
When the selected job has pending approvals, the detail panel shows:
- request identifier
- approval method
- `Approve`
- `Reject`

The reject message can be edited inline before sending the rejection.

Equivalent federation routes:
- `POST /api/approvals/<requestId>/approve`
- `POST /api/approvals/<requestId>/reject`

Expected:
- action banner confirms approval or rejection
- approval list refreshes after the mutation

## 6. Inspect Results
The selected job detail panel shows:
- result summary
- artifact paths

Equivalent federation reads:
- `GET /api/jobs/<jobId>`
- `GET /api/jobs/<jobId>/live`
- `GET /api/jobs/<jobId>/result`

Expected:
- artifact paths are visible without leaving the shell
- result summary updates when the job reaches a terminal state

## 7. Endpoint Overrides
The shell defaults to:
- host: `http://127.0.0.1:8787`
- federation: `http://127.0.0.1:8788`

Browser-mode overrides use document metadata:
- `adhd-host-base-url`
- `adhd-federation-base-url`

The Tauri/native path uses the same endpoint values when forwarding requests through the Rust command bridge.

## 8. Phase 12 Done Signal
Phase 12 is functioning when:
- desktop users can create and inspect jobs from the shell
- desktop users can run start/interrupt/retry actions from the shell
- pending approvals can be approved or rejected from the shell
- host and federation health remain visible while operating jobs
