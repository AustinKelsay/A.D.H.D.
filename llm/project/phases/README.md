# ADHD Phases (V2 Federated Rebuild)

## Purpose
Track implementation from single-host baseline to multi-host orchestration.

## Phase Order
This list is ordinal (`1..n`). The project phase names themselves are zero-based, so item `17` below is the document for `Phase 16`.
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
11. `operations-and-sustainment-phase.md`
12. `tauri-app-shell-phase.md`
13. `desktop-client-phase.md`
14. `mobile-client-phase.md`
15. `dictation-intake-phase.md`
16. `asr-runtime-integration-phase.md`
17. `app-packaging-and-onboarding-phase.md`

## Execution Rules
- Stabilize host-local runtime before federation features.
- Keep single-host mode functional while adding multi-host capabilities.
- Experimental Codex features always require fallback behavior.
- Treat `WORKFLOW.md` as the repo-owned contract for prompt, runtime policy, and hooks; runtime behavior changes should flow through this contract.

## Current Milestone
- `operations-and-sustainment-phase.md` is complete.
- `tauri-app-shell-phase.md` is complete.
- `desktop-client-phase.md` is complete.
- `mobile-client-phase.md` is the next planned phase.
- Phases 14 through 16 are now planned and documented.
