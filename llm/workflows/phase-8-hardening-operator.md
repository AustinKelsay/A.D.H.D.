# Phase 8 Operator Workflow (Review + Hardening)

## Goal
Validate fail-closed workflow behavior, hook safety, and multi-host fallback edges before release prep.

## Preconditions
- host API and federation API are running
- control-plane auth headers are supplied when enabled
- the target repo has a `WORKFLOW.md` with explicit `workspace` and `hooks` policy

## 0. Verify Phase 8 Baseline
```bash
npm run phase8:verify
```

## 1. Confirm Workflow Guardrails
Inspect `WORKFLOW.md` and verify:
- `workspace.root` stays under the repo
- `workspace.require_path_containment: true`
- `hooks.timeout_ms` is bounded
- required hooks (`after_create`, `before_run`) are intentional and deterministic

## 2. Check Host Workflow Status
```bash
curl -sS "http://127.0.0.1:<HOST_PORT>/health"
```

Expected:
- `workflow.preflight.ok` is `true`
- `workflow.status.loaded` is `true`
- `workflow.status.lastError` is `null` during steady state

## 3. Refresh and Re-check Workflow
```bash
curl -sS -X POST "http://127.0.0.1:<HOST_PORT>/api/workflow/refresh" \
  -H "authorization: Bearer <HOST_OR_PROXY_TOKEN>" \
  -H "content-type: application/json" \
  -d '{}'
```

If your host endpoint does not require auth, you can omit the authorization header.

Expected:
- invalid workflow changes fail safely without dropping the last-known-good config
- refreshed status shows current reload telemetry and preflight state

## 4. Inspect Host Metrics
```bash
curl -sS "http://127.0.0.1:<HOST_PORT>/metrics"
```

Expected:
- `metrics.workflowHooks.attempts|successes|failures` reflect recent lifecycle activity
- `metrics.workflowPreflightBlocks` increments when unsafe workflow state blocks actions
- `metrics.workflowRefresh` reflects reload attempts and failures

## 5. Confirm Federation Safety State
```bash
curl -sS "http://127.0.0.1:8787/health" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>"
```

Expected:
- no unexpected `workflow.driftedHosts`
- offline/degraded hosts are visible before dispatch
- operator routing state matches host availability and workflow compatibility
