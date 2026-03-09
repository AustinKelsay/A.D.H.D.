# ADHD Desktop Client Phase (Phase 12)

## Status
Complete.

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

## Work Items
1. Expand the Phase 11 shell into a usable desktop operator view.
2. Add intake and recent-job workflows against the federation API.
3. Add selected-job detail, live approval, and result surfaces.
4. Add desktop mutations for start, interrupt, retry, and retry-start.
5. Add frontend tests and a Phase 12 verification gate.

## Planned Artifacts
- desktop client shell UI under `apps/adhd-shell/src/`
- desktop operator runbook
- Phase 12 verification command

## Current Baseline Artifacts
- `apps/adhd-shell/src/desktop-app.ts`
- `apps/adhd-shell/src/federation-client.ts`
- `apps/adhd-shell/src/backend-transport.ts`
- `apps/adhd-shell/src/styles.css`
- `apps/adhd-shell/src/*.test.ts`
- `llm/workflows/phase-12-desktop-client-operator.md`

## Delivered
- desktop shell now renders intake, hosts, jobs, selected-job detail, approvals, and result views
- desktop shell can create jobs and run start, interrupt, retry, and retry-start actions against federation routes
- approval responses can be sent from the selected-job detail view
- frontend tests cover config, federation client routing, and core desktop render/create flows
- Phase 12 verification now extends Phase 11 verification with desktop shell tests

## Verification
- `npm run phase12:verify`
