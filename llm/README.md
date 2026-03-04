# ADHD LLM Docs

## Purpose
Source of truth for project planning, phase execution, and implementation contracts.

## Current Milestone
- Phase 0 (setup foundation) is active.
- Runtime implementation begins after phase-0 diagnostics, schemas, and compatibility artifacts are in place.

## Folder Intent
- `project/` - canonical product and architecture definitions.
- `project/phases/` - ordered delivery phases and acceptance criteria.
- `project/contracts/` - explicit control-plane and host-node boundaries.
- `workflows/` - repeatable operator/developer runbooks.
- `../src/runtime/` - phase-1 host runtime implementation.
- `../test/` - unit tests for runtime contracts.

## Current Required Docs
- `project/project-overview.md`
- `project/user-flow.md`
- `project/tech-stack.md`
- `project/project-rules.md`
- `project/backlog.md`
- `project/contracts/control-plane-host-node.md`
- `project/phases/setup-phase.md`
- `project/phases/session-runtime-phase.md`
- `project/phases/intent-router-phase.md`
- `project/phases/multi-host-federation-phase.md`
- `workflows/phase-0-bootstrap.md`

## Phase 0 Commands
- `npm run health`
- `npm run schemas:check`
- `npm run compat:snapshot`
- `npm run compat:check`
- `npm run docs:lint`
- `npm run phase0:verify`

## Phase 1 Commands
- `npm test`
- `npm run runtime:smoke`
- `npm run host-api:start`
- `npm run phase1:verify`
