# ADHD Mobile Control Phase (Phase 4)

## Objective
Deliver full mobile parity for operating ADHD jobs.

## In Scope
- mobile auth/pairing
- action parity with desktop
- reconnect-safe streaming

## Work Items
1. Add mobile pairing/session auth flows to host API.
2. Add authenticated mobile route namespace with parity proxying to `/api/*`.
3. Add replayable mobile event log with cursor-based reads and SSE stream support.
4. Expose host-level mobile config knobs for enable/disable, TTLs, event buffering, and heartbeat.
5. Add tests for auth, parity, and replay behavior.

## Exit Criteria
- mobile can start/approve/interrupt/retry jobs
- mobile and desktop remain state-consistent
- mobile reconnects can recover missed events via `after` cursor replay

## Current Baseline Artifacts
- `src/server/mobile-control.js`
- `src/server/host-api.js`
- `scripts/start-host-api.mjs`
- `test/host-api.test.js`
- `llm/workflows/phase-4-mobile-operator.md`

## API Surface (Phase 4 Additions)
- `POST /api/mobile/pairing/start`
  - Creates short-lived pairing code.
- `POST /api/mobile/pairing/complete`
  - Exchanges pairing code for mobile Bearer token/session.
- `GET /api/mobile/session`
  - Returns current authenticated session metadata.
- `POST /api/mobile/session/revoke`
  - Revokes current mobile session token.
- `GET /api/mobile/events?after=<id>&limit=<n>&jobId=<optional>`
  - Cursor replay for reconnect-safe polling.
- `GET /api/mobile/events/stream?after=<id>&jobId=<optional>`
  - SSE stream with heartbeats and replay from cursor.
- `ALL /api/mobile/*` (authenticated parity proxy)
  - Proxies to canonical `/api/*` routes for job controls and approvals.

## Auth and Safety Contract
- Mobile auth is host-local and session-token based.
- Pairing endpoints are the only unauthenticated mobile endpoints.
- All other `/api/mobile/*` routes require `Authorization: Bearer <token>`.
- Client-provided mobile routes cannot bypass existing host/runtime safety gates (`RUNTIME_NOT_READY`, delegation policy enforcement, kill-switch behavior).

## Operator Knobs
- `ADHD_MOBILE_ENABLED=true|false`
- `ADHD_MOBILE_PAIRING_TTL_MS=<positive integer>`
- `ADHD_MOBILE_SESSION_TTL_MS=<positive integer>`
- `ADHD_MOBILE_EVENTS_MAX=<positive integer>`
- `ADHD_MOBILE_HEARTBEAT_MS=<positive integer>`

## Operator Runbook
- `llm/workflows/phase-4-mobile-operator.md`

## Verification Commands
- `npm test`
- `npm run phase4:verify`
