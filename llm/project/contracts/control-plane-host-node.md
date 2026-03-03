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

## Failure Semantics
- Host offline: control plane marks host unavailable for new jobs.
- Dispatch failure: job transitions to terminal failure with host context.
- Host recovery: reconciliation process decides resume vs terminal state.
