# ADHD Mobile Client Phase (Phase 13)

## Status
Planned.

## Objective
Convert the existing mobile API surface into a real app experience with pairing, session management, and operational parity from a phone.

## In Scope
- phone pairing/session UX
- mobile job controls
- approval handling
- reconnect-safe event replay and live updates
- shared client model alignment with desktop shell

## Out of Scope
- full offline dictation
- bundled local ASR runtime

## Exit Criteria
- a mobile user can pair, authenticate, and operate jobs through the app
- mobile state remains consistent with desktop and backend state
- reconnect/replay behavior is explicit and testable at the client boundary

## Dependencies
- Phase 11 app shell
- Phase 12 shared client/state primitives
- existing Phase 4 mobile API surface
