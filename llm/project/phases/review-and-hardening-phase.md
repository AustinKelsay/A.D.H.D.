# ADHD Review & Hardening Phase

## Goals
- Reduce operational risk before broader usage.
- Close behavior gaps around edge cases and destructive workflows.

## Inputs
- `llm/project/project-overview.md`
- `llm/project/user-flow.md`
- `llm/project/phases/*`

## Scope
- In scope: edge-case audit, command surface checks, cleanup and documentation.
- Out of scope: new user-facing feature work.

## Steps
1. **Behavior audit**
   - Verify session lifecycle in all terminal states and cancel/retry edge paths.
2. **Host trust sanity checks**
  - Confirm codex/git/gh assumptions in normal and missing-tool modes.
3. **Security simplification pass**
   - Validate that only high-risk actions are gated in `release` profile.
   - Validate that planner outputs cannot alter arbitrary shell beyond codex templates.
4. **Data cleanup**
  - Ensure stale sessions, partial outputs, and interrupted logs are handled cleanly.
5. **Documentation sync**
  - Align `llm/project/*`, `README`, and implementation notes with shipped behavior.

## Exit Criteria
- Known edge cases are documented and fixed or accepted.
- No orphaned session records after interrupted shutdowns.
- Behavior docs match runtime contracts and launch options.
