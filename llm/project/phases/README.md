# ADHD Phases (V2 Rebuild)

## Purpose
Track the rebuild sequence around Codex app-server + MCP-native orchestration.

## Phase Order
1. `setup-phase.md`
2. `session-runtime-phase.md`
3. `intent-router-phase.md`
4. `mvp-phase.md`
5. `mobile-control-phase.md`
6. `run-catalog-phase.md`
7. `reliability-and-observability-phase.md`
8. `review-and-hardening-phase.md`
9. `release-and-distribution-phase.md`

## Execution Rules
- Do not begin UI-heavy scope before runtime protocol adapter is stable.
- Every phase must leave behind a runnable or testable increment.
- Experimental Codex features must always include a fallback path in the same or next phase.
- Acceptance criteria should be tied to explicit states, methods, and artifacts.

## Current Milestone
- `setup-phase.md` is the active restart point for the V2 rebuild.
