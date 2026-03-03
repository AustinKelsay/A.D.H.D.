# ADHD Project Rules (V2)

## Purpose
Set implementation and documentation rules for the rebuild.

## Directory Contracts
- Planning source of truth: `llm/project/*` and `llm/project/phases/*`
- Runtime implementation must reference these contracts directly.

## Runtime Rules
1. Codex-native control first
- Prefer app-server protocol over shelling ad-hoc CLI commands.
- Use `codex exec` only as explicit fallback paths.

2. No silent policy bypass
- ADHD must not enable bypass flags automatically.
- Approval/sandbox choices are explicit, logged, and user-visible.

3. Stable method boundaries
- Protocol integration must be wrapped in typed adapter functions.
- Required baseline methods for ADHD runtime:
  - `initialize`
  - `thread/start`
  - `turn/start`
  - `turn/interrupt`
  - `thread/read`

4. Event-sourced state transitions
- Every user-visible state change is backed by stored event metadata.
- Terminal states are immutable except via explicit retry/clone actions.

5. Experimental feature isolation
- Any use of `multi_agent` must be guarded by:
  - capability check
  - feature flag
  - fallback path
- Experimental methods must never be assumed available from version string alone; runtime capability checks are required.

## Data Model Rules
Each ADHD job record must include:
- `jobId`
- `inputText` (+ optional transcript metadata)
- `threadId`
- `turnId` (current/last)
- `delegationMode` (`multi_agent` or `fallback_workers`)
- `state`
- `timestamps` (`createdAt`, `updatedAt`, `startedAt`, `endedAt`)
- `policySnapshot` (approval/sandbox/runtime limits)
- `resultSummary` and artifact links (when terminal)

## Documentation Rules
- Behavior-affecting changes must update relevant files in `llm/project/*` and phase docs.
- If Codex protocol assumptions change, update:
  - `project-overview.md`
  - `tech-stack.md`
  - affected phase docs
- Keep dates when noting verified external behavior.

## Testing Rules
Minimum required coverage for each milestone:
- protocol adapter unit tests
- job state transition tests
- approval/interrupt path tests
- restart recovery tests

For experimental paths:
- explicit fallback behavior tests are required before merge.
- parity tests across both delegation modes (`multi_agent`, `fallback_workers`) are required for critical flows.
- compatibility tests against committed app-server schema snapshots are required before release.
