# Phase 7 Operator Workflow (Reliability + Observability)

## Goal
Detect host health/workflow drift early, reconcile deterministically, and expose actionable metrics.

## Preconditions
- federation API is running
- hosts are registered/enrolled
- control-plane auth headers are supplied when enabled

## 1. Check Control Plane Health + Drift
```bash
curl -sS "http://127.0.0.1:8787/health" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>"
```

Expected:
- `hosts.online` reflects live heartbeat state
- `workflow.expectedContentHash` is set when configured
- `workflow.driftedHosts` lists mismatched hosts

## 2. Inspect Federation Metrics
```bash
curl -sS "http://127.0.0.1:8787/metrics" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>"
```

Expected:
- `metrics.counters.hostRegisters|hostEnrollments|hostHeartbeats` advance
- `metrics.errorCounts` shows failure distribution by error code

## 3. Reconcile Host Outage Impact
```bash
curl -sS -X POST "http://127.0.0.1:8787/api/hosts/reconcile" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>" \
  -H "content-type: application/json" \
  -d '{}'
```

Expected:
- `transitions` includes non-terminal jobs blocked by offline/degraded hosts

## 4. Trigger Host Workflow Refresh
```bash
curl -sS -X POST "http://127.0.0.1:<HOST_PORT>/api/workflow/refresh" \
  -H "content-type: application/json" \
  -d '{}'
```

Expected:
- response includes `refresh` outcome and live `workflow` status/preflight

## 5. Inspect Host Metrics
```bash
curl -sS "http://127.0.0.1:<HOST_PORT>/metrics"
```

Expected:
- `metrics.workflowRefresh` tracks attempts/success/failure
- `metrics.workflowPreflightBlocks` increments when workflow gating blocks run/start routes
