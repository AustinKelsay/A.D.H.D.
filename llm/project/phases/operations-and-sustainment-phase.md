# ADHD Operations and Sustainment Phase (Phase 10)

## Status
In progress.

## Objective
Turn the released federated ADHD stack into a maintainable, repeatable operational system.

## In Scope
- release canary and soak procedures
- daily operational health review
- incident triage and rollback coordination
- maintenance-window workflow for host/control-plane changes
- documentation alignment for steady-state operations

## Exit Criteria
- operators can validate a release after deployment with a repeatable canary checklist
- incident handling is documented against real health, metrics, and workflow signals
- maintenance tasks have explicit pre-checks, execution steps, and post-checks

## Delivered So Far
- Phase 10 verification entrypoint (`npm run phase10:verify`) reuses the Phase 9 release-readiness gate, including the inherited docs validation already present in the phase chain
- operator runbook covers post-release canary and soak checks, daily health review, incident triage, and maintenance-window procedure
- project milestone and backlog tracking are updated to make operations work the active delivery target

## Current Focus
- keep release canary, soak, daily checks, and incident/maintenance procedures aligned with the current host and federation APIs
- add additional operational proof only when it improves repeatability beyond the inherited Phase 9 readiness checks

## Verification
- `npm run phase10:verify`
- `npm run docs:lint`
