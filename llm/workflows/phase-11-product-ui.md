# Phase 11 Runbook: Product UI

## Goal
Operate ADHD through a single, responsive product UI that exposes the existing control-plane and host capabilities without dropping back to raw API usage for normal work.

## Operator Inputs
- use the product UI as the default entrypoint for job intake, live control, and replay
- keep the host and federation API URLs available as a fallback when the UI is unavailable
- supply the same control-plane auth headers and mobile session requirements that the backend already enforces

## 0. Open The Workspace
1. Start the federation API:
```bash
npm run federation-api:start
```
2. Load the operator UI at `http://127.0.0.1:8787/`.
3. If your deployment protects control-plane mutations, enter the Bearer token into the UI token field.
4. Confirm the UI shows host health and backend readiness signals.
5. Confirm the current workspace is pointing at the expected control plane.

Expected:
- host and federation status are visible before creating new work
- the UI makes it obvious whether the control plane is ready, degraded, or offline

## 1. Start A Task
1. Enter dictation or typed text into the intake surface.
2. Review the normalized intent and inferred delegation choice.
3. Submit the job to the intended host.

Expected:
- the submitted task appears immediately in the job list
- the job detail panel shows live state transitions, not stale snapshots
- the operator can see whether the job will use `multi_agent` or fallback workers

## 2. Manage Live Work
1. Open the job detail view for any running or paused job.
2. Use the live controls to interrupt, retry, or approve pending work.
3. Confirm the result panel updates when the job reaches a terminal state.

Expected:
- pending approvals are visible without leaving the job view
- interrupt and retry actions reflect the same state as the backend
- completed jobs expose result summary and artifact paths in the UI

## 3. Review Hosts And Catalog
1. Open the host dashboard.
2. Check online, degraded, or offline state before dispatching more work.
3. Use catalog search to find past runs by host, state, repo, date, or text.

Expected:
- host drift and workflow health are easy to scan
- past jobs can be replayed or cloned from the catalog surface
- control-plane state and host-local state remain clearly separated

## 4. Mobile Check
1. Open the UI at a narrow viewport or on a phone.
2. Confirm the same job list, live detail, and approvals are usable on mobile.
3. Verify reconnect or refresh does not lose the operator's place.

Expected:
- mobile layout preserves the critical control loop
- action labels and statuses remain readable on small screens
- the same backend job state is visible across desktop and mobile

## 5. Fallback Mode
If the UI is unavailable, operators should fall back to the existing API surface:
- `GET /health`
- `GET /api/jobs`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/live`
- `GET /api/jobs/:jobId/result`
- `POST /api/jobs`
- `POST /api/jobs/:jobId/start`
- `POST /api/jobs/:jobId/interrupt`
- `POST /api/jobs/:jobId/retry`
- `GET /api/hosts`
- `GET /api/hosts/:hostId`
- `POST /api/hosts/reconcile`
- `GET /api/mobile/events`

## Notes
- the UI should never hide backend errors; it should translate them into operator-readable states
- live state must continue to come from the backend APIs and catalog, not a separate client-side store
- this runbook intentionally mirrors the existing API shape so the UI remains a thin operator layer over the system of record
