# Phase 10 Runbook: Operations and Sustainment

## Goal
Run the released system safely in steady state: validate releases, review health, and respond to operational drift or incidents.

## Operator Inputs
- use separate ports when running host and federation APIs locally; examples below use `<HOST_PORT>=8787` and `<FEDERATION_PORT>=8788`
- supply `authorization: Bearer <CONTROL_PLANE_TOKEN>` to federation requests when your deployment requires it
- supply `authorization: Bearer <HOST_OR_PROXY_TOKEN>` to host workflow refresh requests when your deployment requires it
- use [phase-9-host-bootstrap.md](./phase-9-host-bootstrap.md) for fresh bring-up and [phase-9-workflow-rollout.md](./phase-9-workflow-rollout.md) for staged `WORKFLOW.md` rollout/rollback

If your local deployment does not enforce auth on these endpoints, you can omit the authorization headers in the examples below.

## 0. Verify Phase 10 Baseline
```bash
npm run phase10:verify
```

## 1. Post-Release Canary
Run these checks after each host or control-plane release:

1. Verify the baseline:
```bash
npm run phase10:verify
```

2. Confirm host health:
```bash
curl -sS "http://127.0.0.1:<HOST_PORT>/health"
```

3. Confirm federation health:
```bash
curl -sS "http://127.0.0.1:<FEDERATION_PORT>/health" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>"
```

4. Inspect host metrics:
```bash
curl -sS "http://127.0.0.1:<HOST_PORT>/metrics"
```

5. Inspect federation metrics:
```bash
curl -sS "http://127.0.0.1:<FEDERATION_PORT>/metrics" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>"
```

6. If the release changed `WORKFLOW.md`, refresh one host first:
```bash
curl -sS -X POST "http://127.0.0.1:<HOST_PORT>/api/workflow/refresh" \
  -H "authorization: Bearer <HOST_OR_PROXY_TOKEN>" \
  -H "content-type: application/json" \
  -d '{}'
```

7. Run one bounded deep runtime smoke when release risk is elevated:
```bash
ADHD_RUNTIME_SMOKE_TIMEOUT_MS=60000 node scripts/runtime-smoke.mjs --initialize
```

8. Submit or observe one low-risk canary job before broader traffic.

Expected:
- host `runtime.ready` is `true`
- host `workflow.preflight.ok` is `true`
- federation `hosts.online` and `workflow.driftedHosts` match expectations for the rollout
- host metrics show no unexpected increase in `workflowRefresh.failures`, `workflowHooks.failures`, or `workflowPreflightBlocks`
- federation metrics show no unexpected increase in `errorCounts`, `counters.reconcileBlockedJobs`, or `counters.workflowDriftDetections`
- canary job routes and completes on the intended host

## 2. Release Soak Window
After the canary succeeds, keep the release under observation for a bounded soak window before broader traffic or the next rollout step.

Minimum soak review:
- recheck host `/metrics`
- recheck federation `/metrics`
- confirm `workflowRefresh.failures`, `workflowHooks.failures`, and `workflowPreflightBlocks` stay stable
- confirm federation `errorCounts`, `counters.reconcileBlockedJobs`, and `workflow.driftedHosts` stay stable
- confirm no additional hosts become degraded or offline

Escalate and stop rollout when:
- failure counters continue to increase during the soak window
- drift expands beyond the hosts intentionally being changed
- canary behavior is successful once but not repeatable

## 3. Daily Checks
Review at least:
- `http://127.0.0.1:<FEDERATION_PORT>/health`
- `http://127.0.0.1:<FEDERATION_PORT>/metrics`
- `http://127.0.0.1:<HOST_PORT>/health`
- `http://127.0.0.1:<HOST_PORT>/metrics`
- workflow drift state and host refresh telemetry

Escalate when:
- `hosts.online` drops unexpectedly or a host stays degraded
- `workflow.driftedHosts` grows unexpectedly after rollout or maintenance
- `workflowPreflightBlocks` is non-zero for fresh work
- `workflowRefresh.failures` or `workflowHooks.failures` rises after rollout
- federation `errorCounts` accumulates new operational errors or `reconcileBlockedJobs` rises unexpectedly

## 4. Incident Triage
When a release or host issue is reported:
1. capture host and federation `/health` plus `/metrics`
2. identify affected hosts, workflow hashes, and whether dispatch is blocked by drift policy
3. classify the incident as `host-local`, `workflow-drift`, or `control-plane-wide`
Host-local means one host is offline/degraded, local hook failures are rising, or only one host reports preflight failures.
Workflow-drift means `workflow.driftedHosts` is non-empty or refresh/preflight failures began after a workflow change.
Control-plane-wide means multiple hosts fail at once, reconciliation blocks accumulate, or federation `errorCounts` spikes.
4. choose the smallest effective action
For `host-local`, isolate or restart the affected host.
For `workflow-drift`, refresh or roll back via [phase-9-workflow-rollout.md](./phase-9-workflow-rollout.md).
For `control-plane-wide`, use [phase-9-host-bootstrap.md](./phase-9-host-bootstrap.md) to drive rollback or control-plane recovery.
5. rerun `npm run phase10:verify` and at least one representative job path after mitigation

## 5. Maintenance Window Checklist
Before maintenance:
- confirm host and federation health are stable
- record current release/tag and workflow hash
- capture pre-maintenance `/health` and `/metrics`
- confirm rollback owner, rollback revision, and expected maintenance window scope

During maintenance:
- apply one class of change at a time when possible: host runtime, control-plane runtime, or `WORKFLOW.md`
- if `WORKFLOW.md` changes, use the staged rollout flow in [phase-9-workflow-rollout.md](./phase-9-workflow-rollout.md) instead of bulk refresh

After maintenance:
- rerun `npm run phase10:verify`
- confirm host and federation `/health`
- confirm host and federation `/metrics`
- confirm no new drift, refresh, hook, or preflight failures
- confirm at least one representative job path still succeeds
