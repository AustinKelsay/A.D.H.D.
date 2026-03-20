# ADHD Product UI Phase (Phase 11)

## Status
Complete.

## Objective
Deliver a first-class operator UI on top of the established control-plane and host APIs.

## In Scope
- desktop and mobile-friendly operator workspace
- job intake, job list, job detail, live state, and result views
- approvals, interrupt, retry, rerun, and clone controls
- host health, workflow status, and drift visibility
- catalog search and replay surfaces across hosts
- responsive error, loading, and empty states for host and control-plane failures
- consistent routing to the existing host, federation, mobile, and catalog APIs

## Exit Criteria
- operators can complete the full task loop without raw API calls
- job creation, live control, approvals, and result inspection are available in one UI
- host health, workflow drift, and run catalog history are visible and actionable
- desktop and mobile views reflect the same underlying job state
- UI failures degrade safely without hiding backend errors or breaking control-plane invariants

## Current Baseline Artifacts
- `src/server/operator-ui.js`
- `src/ui/phase11/index.html`
- `src/ui/phase11/app.js`
- `src/ui/phase11/styles.css`
- `src/server/host-api.js`
- `src/server/federation-api.js`
- `src/server/mobile-control.js`
- `src/runtime/session-store.js`
- `src/workflow/store.js`
- `test/host-api.test.js`
- `test/federation-api.test.js`
- `llm/project/project-overview.md`
- `llm/project/user-flow.md`
- `llm/project/contracts/control-plane-host-node.md`
- `llm/project/phases/mvp-phase.md`
- `llm/project/phases/mobile-control-phase.md`
- `llm/project/phases/multi-host-federation-phase.md`
- `llm/project/phases/run-catalog-phase.md`
- `llm/project/phases/operations-and-sustainment-phase.md`
- `llm/workflows/phase-3-mvp-operator.md`
- `llm/workflows/phase-4-mobile-operator.md`
- `llm/workflows/phase-5-federation-operator.md`
- `llm/workflows/phase-10-operations-operator.md`

## Implementation Notes
- the UI should treat the existing APIs as the source of truth rather than duplicating job or host state
- mobile parity should reuse the same state model as desktop, not a separate control path
- host health, workflow drift, and replay should be surfaced as operator signals, not hidden implementation details

## Delivered
- control-plane root now serves the Phase 11 operator console
- operator UI covers dispatch, jobs list/detail, live state, approvals, replay, and host workflow controls
- federation exposes UI-facing approval aggregation plus host metrics and workflow refresh proxy routes
- responsive operator layout works for desktop and narrow mobile viewports without introducing a separate client stack

## Operator Runbook
- `llm/workflows/phase-11-product-ui.md`

## Verification Commands
- `npm run phase11:verify`
- `npm test`
