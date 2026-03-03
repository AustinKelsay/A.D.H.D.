# ADHD Mobile Control Phase (Phase 4)

## Objective
Make phone control first-class for monitoring and steering Codex jobs remotely.

## In Scope
- Mobile-authenticated session access
- Job list/detail with real-time updates
- Start/approve/interrupt/retry parity with desktop

## Out of Scope
- Native mobile app packaging in this phase

## Work Items
1. Auth and pairing
- Implement secure pairing and token/session lifecycle.

2. Mobile action parity
- Match desktop semantics and terminology exactly.

3. Resilient realtime
- Reconnect-safe streaming with stale-state protection.

4. Speech fallback
- Support typed submission when mobile dictation is unavailable.

## Exit Criteria
- Mobile can run and control jobs without desktop intervention.
- State consistency between desktop and mobile is reliable under reconnects.
