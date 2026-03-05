# ADHD Phases (V2 Federated Rebuild)

## Purpose
Track implementation from single-host baseline to multi-host orchestration.

## Phase Order
1. `setup-phase.md`
2. `session-runtime-phase.md`
3. `intent-router-phase.md`
4. `mvp-phase.md`
5. `mobile-control-phase.md`
6. `multi-host-federation-phase.md`
7. `run-catalog-phase.md`
8. `reliability-and-observability-phase.md`
9. `review-and-hardening-phase.md`
10. `release-and-distribution-phase.md`

## Execution Rules
- Stabilize host-local runtime before federation features.
- Keep single-host mode functional while adding multi-host capabilities.
- Experimental Codex features always require fallback behavior.
- Treat `WORKFLOW.md` as the repo-owned contract for prompt, runtime policy, and hooks; runtime behavior changes should flow through this contract.

## Current Milestone
- `review-and-hardening-phase.md` is the active restart point.
