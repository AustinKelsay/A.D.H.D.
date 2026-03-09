# ADHD Desktop Client Phase (Phase 12)

## Status
Planned.

## Objective
Turn the Tauri shell into a usable desktop operator client so ADHD no longer requires curl-first operation.

## In Scope
- desktop intake UI
- job list and job detail views
- live state and result views
- host/federation health surface
- basic approvals and job control actions

## Out of Scope
- mobile parity
- microphone capture
- bundled ASR runtime

## Exit Criteria
- a desktop user can create, start, inspect, interrupt, retry, and review jobs from the app
- host and federation health are visible in the app without dropping to terminal commands
- core desktop workflows cover the existing host/control-plane API surface

## Dependencies
- Phase 11 app shell
- stable API client contract for host and federation endpoints
