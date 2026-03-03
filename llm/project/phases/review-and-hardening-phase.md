# ADHD Review and Hardening Phase (Phase 7)

## Objective
Reduce release risk by validating edge cases, safety controls, and fallback behavior.

## In Scope
- Lifecycle edge-case audit
- Approval/sandbox policy validation
- Experimental feature fallback validation
- Documentation and runbook synchronization

## Out of Scope
- Net-new feature scope

## Work Items
1. Runtime edge-case sweep
- Interrupt during delegation, partial worker failure, and timeout scenarios.

2. Safety control verification
- Confirm no hidden bypass of approval/sandbox policy.

3. Experimental fallback drills
- Force-disable multi-agent and confirm fallback path quality.
- Validate live kill-switch behavior during active operations and for newly queued jobs.

4. Doc and runbook alignment
- Ensure shipped behavior matches `llm/project/*` contracts.

## Exit Criteria
- Known high-risk paths are either fixed or explicitly accepted with mitigation.
- Fallback behavior is tested and documented.
- Delegation parity evidence exists for both `multi_agent` and `fallback_workers` on critical flows.
