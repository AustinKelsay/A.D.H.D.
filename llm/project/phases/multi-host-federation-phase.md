# ADHD Multi-Host Federation Phase (Phase 5)

## Objective
Enable one ADHD control plane to orchestrate multiple host machines.

## In Scope
- host enrollment and revocation
- host heartbeat/capability sync
- per-job host targeting and host-aware dispatch
- host outage handling and recovery behavior

## Work Items
1. Host registry
- Add `hostId`, host metadata, auth status, compatibility status.

2. Secure enrollment
- Add signed token/certificate-based enrollment and revocation flow.

3. Host routing
- Manual host selection first; optional auto-routing policy later.

4. Host-aware controls
- Route interrupt/retry/approve actions to correct host.

5. Outage policy
- Define and implement behavior for offline hosts and stranded jobs.

## Current Baseline Artifacts
- `src/server/federation-api.js`
- `src/server/host-api.js`
- `config/schemas/host.schema.json`
- `config/schemas/job.schema.json`
- `test/federation-api.test.js`
- `llm/workflows/phase-5-federation-operator.md`

## API Surface (Phase 5 Additions)
- `POST /api/hosts/register`
  - Registers host metadata and returns one-time enrollment token.
- `POST /api/hosts/:hostId/enroll`
  - Exchanges enrollment token for scoped host heartbeat token.
- `POST /api/hosts/:hostId/heartbeat`
  - Authenticated host heartbeat and capability/compatibility sync.
- `POST /api/hosts/:hostId/revoke`
  - Revokes host auth tokens and blocks new dispatch.
- `GET /api/hosts`
  - Lists hosts with auth + heartbeat status.
- `GET /api/hosts/:hostId`
  - Returns one host record.
- `POST /api/jobs` (control-plane)
  - Requires `hostId`; routes intake/create to that specific host.
- `GET /api/jobs` (control-plane aggregation)
  - Aggregates jobs across configured hosts.
  - Supports optional `hostId` query filter to limit results to one host.
  - Returns host-bound job records (including `hostId`) for control-plane views.
- `POST /api/jobs/:jobId/start|interrupt|retry`
  - Routes control actions to routed host.
- `POST /api/hosts/reconcile`
  - Reports outage-blocked in-flight jobs deterministically.

## Phase 5 Policy Notes
- Host enrollment and heartbeat are token-gated.
- Control-plane privileged mutation routes may be operator-auth gated via `verifyControlPlaneToken`.
- Dispatch/start/retry/interrupt are blocked unless host is `enrolled` and `online`.
- Revoked hosts cannot receive new jobs.
- Outage behavior is deterministic and test-covered.

## Exit Criteria
- same app can operate Host A and Host B
- each job is clearly bound to one host
- outage handling is deterministic and test-covered

## Verification Commands
- `npm run federation-api:start`
- `npm test`
- `npm run phase5:verify`
