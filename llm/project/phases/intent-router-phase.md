# ADHD Intent Router Phase (Phase 2)

## Objective
Define the conductor contract that transforms user intent into delegation-ready Codex tasks.

## In Scope
- Input normalization contract
- Conductor system/developer prompt design
- Plan JSON contract validation
- Delegation mode selection rules (`multi_agent` vs fallback)

## Out of Scope
- Full mobile UX
- Long-term analytics

## Work Items
1. Input normalization
- Convert voice/text into a stable task object with repo/path constraints.

2. Conductor prompt package
- Version prompt files used to control planning/delegation behavior.

3. Plan contract
- Require structured plan output (subtasks, role hints, risk flags, acceptance checks).
- Reject malformed plans before execution.

4. Delegation policy
- If multi-agent is supported and enabled, use role-based delegation.
- Otherwise execute through fallback worker path.
- Allow runtime kill-switch override to force fallback mode for all new jobs.

5. Approval policy integration
- Ensure risky operations route through explicit approval events.

## Exit Criteria
- Same input yields reproducible plan shape.
- Delegation mode is explicit and logged for every job.
- Invalid plan output fails safely before worker execution.
