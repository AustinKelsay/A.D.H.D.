# ADHD Reliability and Observability Phase (Phase 7)

## Status
Complete.

## Objective
Harden federated runtime behavior and operational visibility.

## In Scope
- host heartbeat and reconnect resilience
- structured logs and metrics across control plane + hosts
- protocol drift detection automation
- workflow reload telemetry (parse errors, last-known-good active config, host workflow drift)

## Exit Criteria
- host/network interruptions do not silently corrupt state
- diagnostics make failures actionable without ad-hoc probing
- compatibility drift is detected before release
- workflow reload failures are visible and recoverable without service restart

## Delivered
- deterministic host outage gating for mutating control-plane actions
- explicit drift policy with host workflow hash reconciliation (`warn`, `block_dispatch`)
- host and federation `/metrics` endpoints with lifecycle/error counters
- host workflow refresh endpoint (`POST /api/workflow/refresh`) with telemetry
- startup structured telemetry helper shared across host/federation scripts

## Verification
- `npm test`
- `npm run phase7:verify`
