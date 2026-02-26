# ADHD Mobile Control Phase

## Goals
- Enable phone-native control and visibility over the same orchestration host.
- Keep transport simple while preserving user trust and session safety.

## Inputs
- `llm/project/project-overview.md`
- `llm/project/user-flow.md`
- `llm/project/project-rules.md`

## Scope
- In scope: authenticated control endpoint, session list/detail views, start/stop/retry actions, and orchestrator-driven plan submission.
- Out of scope: feature-complete mobile-native editor and file explorers.

## Steps (per feature)
1. **Control surface**
  - Expose secure local endpoint for session operations and live status polling/streaming.
2. **Session UX**
  - Build phone-friendly session list, active session card, and action controls.
3. **Cross-device consistency**
  - Ensure action semantics match desktop (`id` based, same action names, same state labels).
4. **Pairing/auth**
  - Add lightweight host pairing token flow for phone authorization.
5. **Fallback path**
   - Support typed task input when phone speech capture is unavailable.

## Exit Criteria
- Phone users can create, inspect, and control sessions.
- Session state updates are coherent between phone and desktop within acceptable delay.
- Pairing token prevents accidental unauthenticated control attempts.
