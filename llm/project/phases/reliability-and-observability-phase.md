# ADHD Reliability and Observability Phase (Phase 6)

## Objective
Harden runtime behavior for long-running orchestration and protocol churn.

## In Scope
- Recovery after process/network interruptions
- Structured event logging and error taxonomy
- Health and readiness endpoints

## Out of Scope
- Distributed tracing stack

## Work Items
1. Bridge resilience
- Auto-restart/reconnect app-server bridge with bounded retries.

2. Recovery and reconciliation
- Recover in-flight jobs and reconcile stale sessions.

3. Observability model
- Structured logs keyed by job/thread/turn IDs.
- Metrics for queue depth, job durations, failures, approvals.

4. Error taxonomy
- Standardize error categories and user remediation messages.

5. Churn detection
- Add automated checks that compare current protocol schema/methods against the committed compatibility baseline.
- Emit a high-signal warning when experimental surfaces drift.

## Exit Criteria
- Restart and reconnect scenarios do not silently lose job truth.
- Operators can diagnose failures from logs/metrics without ad-hoc probing.
- Experimental protocol drift is detected before release by automation.
