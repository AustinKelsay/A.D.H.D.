# ADHD Reliability and Observability Phase

## Goals
- Make ADHD resilient to process churn, reconnects, and host/tool volatility.
- Improve debuggability for sessions, transport, and runtime commands.

## Inputs
- `llm/project/project-overview.md`
- `llm/project/project-rules.md`
- `llm/project/phases/session-runtime-phase.md`

## Scope
- In scope: retries, backoff, heartbeat/ping, structured logs, minimal metrics.
- Out of scope: advanced distributed telemetry and centralized logging stacks.

## Steps (per feature)
1. **Runner resilience**
  - Add retry strategy for transient runner start failures and process respawn boundaries.
2. **State recovery**
  - Restore in-memory session state from persisted catalog on startup.
3. **Health signals**
  - Add heartbeat endpoint and basic binary/tool/plan-provider health checks.
4. **Log discipline**
- Standardize JSON or line-delimited logs with session IDs and profile fields.
5. **Error taxonomy**
  - Standardize error categories (`missing-tool`, `invalid-profile`, `runtime-crash`, `transport-loss`, `orchestrator-unavailable`, `orchestrator-invalid-plan`).

## Exit Criteria
- Host/tool outages produce clear recoverable states, not silent failures.
- Restarting the app restores active session list context safely.
- Logs include enough session context to reproduce last known state quickly.
