# Control Plane vs Host Node Contract

## Purpose
Define ownership boundaries between the ADHD control plane and ADHD host nodes.

## Control Plane Responsibilities
- Own operator-facing APIs and UX (desktop + mobile).
- Store host registry, global job records, and routing decisions.
- Dispatch jobs to target hosts.
- Relay approvals/interrupts/retries to correct host.
- Aggregate host events into one global timeline.

## Host Node Responsibilities
- Own local Codex runtime lifecycle.
- Run conductor and worker execution on the local machine only.
- Validate local capabilities and compatibility.
- Stream execution events and artifacts to control plane.
- Enforce local approval/sandbox policy constraints.

## Contracted IDs
- `hostId`: global host identity assigned by control plane.
- `jobId`: global job identity assigned by control plane.
- `hostJobId`: host-local correlation id.
- `threadId` / `turnId`: Codex protocol correlation ids.

## Phase 5 API Contract
Control-plane host lifecycle endpoints:
- `POST /api/hosts/register`
  - Input: `hostId`, optional `displayName`
  - Output: host record + one-time `enrollmentToken`
- `POST /api/hosts/:hostId/enroll`
  - Input: `enrollmentToken`, optional capability/compatibility payload
  - Output: enrolled host + scoped `hostToken`
- `POST /api/hosts/:hostId/heartbeat`
  - Auth: `Authorization: Bearer <hostToken>` (or body `hostToken`)
  - Output: updated host heartbeat/capability status
- `POST /api/hosts/:hostId/revoke`
  - Output: host `auth.status = revoked`; heartbeat marked offline
- `GET /api/hosts`
- `GET /api/hosts/:hostId`

Control-plane routing endpoints:
- `POST /api/jobs` requires `hostId` and dispatches to that host.
- `GET /api/jobs` aggregates jobs across configured hosts.
- `POST /api/jobs/:jobId/start|interrupt|retry` routes by recorded host binding.
- `POST /api/approvals/:requestId/approve|reject` requires `hostId` for explicit host routing.
- `GET /api/jobs/:jobId/live` and `GET /api/jobs/:jobId/result` are host-routed read surfaces.
- `POST /api/hosts/reconcile`
  - Input: optional reconciliation hints (`hostId`, `lastSeenToken`, `lastHeartbeat`).
  - Output: reconciliation result with per-job actions such as `mark-offline`, `re-enqueue`, `clear-host-token`, or `blocked-by-host-outage` depending on policy/runtime state.

## Auth and Trust Notes
- Enrollment token is one-time for host enrollment.
- Heartbeat token (`hostToken`) is scoped per-host and required for heartbeat updates.
- Revoked hosts cannot accept new dispatches.
- Current Phase 5 baseline keeps enrollment/heartbeat tokens in-memory only (process-local); restart clears them.

## Common Errors And Status Codes
- `HOST_UNAUTHORIZED` -> `401`
  - Enrollment or heartbeat token is missing/invalid.
- `HOST_OFFLINE` -> `503`
  - Host heartbeat is degraded/offline for an operation requiring online execution.
- `HOST_REVOKED` -> `409`
  - Host has been revoked and cannot receive new dispatch/control actions.
- `HOST_NOT_ENROLLED` -> `409`
  - Host exists but has not completed enrollment (or has been revoked).

## Failure Semantics
- Host offline: control plane marks host unavailable for new jobs.
- Dispatch failure: job transitions to terminal failure with host context.
- Host recovery: reconciliation process decides resume vs terminal state.
