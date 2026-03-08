# Phase 9 Runbook: Workflow Rollout and Rollback

## Goal
Roll out `WORKFLOW.md` changes across hosts with explicit versioning, staging, drift checks, and rollback steps.

## Versioning Rules
- treat each `WORKFLOW.md` change as a releaseable artifact
- record the expected content hash before rollout
- do not mix workflow edits with unrelated host-runtime changes during rollout

## 0. Verify Baseline
```bash
npm run phase9:verify
```

## 1. Stage the Workflow Change
1. edit `WORKFLOW.md`
2. validate locally:
```bash
npm test
```
3. if hooks or workspace policy changed, re-check:
```bash
npm run phase8:verify
```

## 2. Refresh a Single Host First
```bash
curl -sS -X POST "http://127.0.0.1:<HOST_PORT>/api/workflow/refresh" \
  -H "authorization: Bearer <HOST_OR_PROXY_TOKEN>" \
  -H "content-type: application/json" \
  -d '{}'
```

If your host endpoint does not require auth, you can omit the authorization header.

Expected:
- `refresh.ok` is `true`
- `workflow.preflight.ok` is `true`
- host health reflects the new content hash

## 3. Validate Federation Drift State
```bash
curl -sS "http://127.0.0.1:8787/health" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>"
```

Expected:
- the staged host may differ temporarily
- `workflow.driftedHosts` shrinks to zero as rollout completes
- `block_dispatch` policy does not leave unexpected hosts eligible

## 4. Roll Out Host by Host
For each remaining host:
1. refresh workflow
2. confirm host `/health`
3. confirm federation `/health` drift summary
4. inspect `/metrics` if refresh or hooks fail

Do not continue rollout if:
- refresh fails on any host
- preflight becomes false
- hook failures spike after refresh

## 5. Rollback Procedure
Rollback when:
- a workflow change introduces parse/preflight failure
- rollout causes hook failures or blocked dispatches
- federation drift does not converge after refresh

Rollback steps:
1. restore prior `WORKFLOW.md`
2. refresh the canary host first
3. confirm health/preflight is restored
4. refresh remaining hosts
5. confirm `workflow.driftedHosts` returns to expected state

## 6. Post-Rollout Verification
```bash
curl -sS "http://127.0.0.1:<HOST_PORT>/metrics"
curl -sS "http://127.0.0.1:8787/metrics" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>"
```

Expected:
- no new sustained workflow refresh failures
- no unexpected workflow preflight blocks
- host/federation telemetry matches the intended rollout state
