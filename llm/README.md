# ADHD LLM Docs

## Purpose
Source of truth for project planning, phase execution, and implementation contracts.

## Current Milestone
- Phase 3 (single-host MVP loop) baseline is implemented.
- Next build target is Phase 4 (mobile control parity).

## Folder Intent
- `project/` - canonical product and architecture definitions.
- `project/phases/` - ordered delivery phases and acceptance criteria.
- `project/contracts/` - explicit control-plane and host-node boundaries.
- `workflows/` - repeatable operator/developer runbooks.
- `../src/runtime/` - phase-1 host runtime implementation.
- `../src/intent/` - phase-2 intent normalization, plan validation, and delegation policy.
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
- `project/phases/mvp-phase.md`
- `project/phases/multi-host-federation-phase.md`
- `workflows/phase-0-bootstrap.md`
- `workflows/phase-3-mvp-operator.md`

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

## Phase 2 Commands
- `npm test`
- `npm run phase2:verify`

## Phase 2 Contracts
- `config/schemas/intent.schema.json` (`intent.v1`)
- `config/schemas/plan.schema.json` (`plan.v1`)

## Phase 2 Host Knobs
- `ADHD_HOST_MULTI_AGENT`
- `ADHD_DELEGATION_DEFAULT_MODE`
- `ADHD_DELEGATION_ALLOW_MULTI_AGENT`
- `ADHD_MULTI_AGENT_KILL_SWITCH`

## Phase 3 Commands
- `npm test`
- `npm run phase3:verify`

## Phase 3 Runbook
- `llm/workflows/phase-3-mvp-operator.md`
