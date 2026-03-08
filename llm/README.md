# ADHD LLM Docs

## Purpose
Source of truth for project planning, phase execution, and implementation contracts.

## Current Milestone
- Phase 9 (release and distribution) is complete.
- Phase 10 (operations and sustainment) is complete.
- No Phase 11 is defined yet.

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
- `project/contracts/workflow-contract.md`
- `project/phases/setup-phase.md`
- `project/phases/session-runtime-phase.md`
- `project/phases/intent-router-phase.md`
- `project/phases/mvp-phase.md`
- `project/phases/mobile-control-phase.md`
- `project/phases/multi-host-federation-phase.md`
- `project/phases/run-catalog-phase.md`
- `project/phases/reliability-and-observability-phase.md`
- `project/phases/review-and-hardening-phase.md`
- `project/phases/release-and-distribution-phase.md`
- `project/phases/operations-and-sustainment-phase.md`
- `workflows/phase-0-bootstrap.md`
- `workflows/phase-3-mvp-operator.md`
- `workflows/phase-4-mobile-operator.md`
- `workflows/phase-5-federation-operator.md`
- `workflows/phase-6-run-catalog-operator.md`
- `workflows/phase-7-reliability-operator.md`
- `workflows/phase-8-hardening-operator.md`
- `workflows/phase-9-host-bootstrap.md`
- `workflows/phase-9-workflow-rollout.md`
- `workflows/phase-10-operations-operator.md`

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

## Phase 6 Host Knobs
- `ADHD_WORKFLOW_PATH` (optional path override for `WORKFLOW.md`; defaults to repo root, then host cwd)

## Phase 3 Commands
- `npm test`
- `npm run phase3:verify`

## Phase 3 Runbook
- `workflows/phase-3-mvp-operator.md`

## Phase 4 Commands
- `npm test`
- `npm run phase4:verify`

## Phase 4 Runbook
- `workflows/phase-4-mobile-operator.md`

## Phase 5 Commands
- `npm run federation-api:start`
- `npm test`
- `npm run phase5:verify`

## Phase 5 Runbook
- `workflows/phase-5-federation-operator.md`

## Phase 6 Commands
- `npm run phase6:verify`

## Phase 6 Runbook
- `workflows/phase-6-run-catalog-operator.md`

## Phase 7 Commands
- `npm run phase7:verify`

## Phase 7 Host Knobs
- `ADHD_WORKFLOW_DRIFT_POLICY` (`warn` or `block_dispatch`)

## Phase 7 Runbook
- `workflows/phase-7-reliability-operator.md`

## Phase 8 Commands
- `npm run phase8:verify`

## Phase 8 Workflow Guardrails
- `workspace.root` is resolved under the repo and rejected if it escapes containment.
- `hooks.timeout_ms` bounds shell hook execution time.
- `hooks.after_create` and `hooks.before_run` fail closed for new attempts.
- `hooks.after_run` and `hooks.before_remove` are best effort and preserve cleanup flow.
- hook stdout/stderr is redacted and truncated before surfacing in telemetry/errors.

## Phase 8 Runbook
- `workflows/phase-8-hardening-operator.md`

## Phase 9 Commands
- `npm run phase9:verify`

## Phase 9 Runbooks
- `workflows/phase-9-host-bootstrap.md`
- `workflows/phase-9-workflow-rollout.md`

## Phase 10 Commands
- `npm run phase10:verify`

## Phase 10 Runbook
- `workflows/phase-10-operations-operator.md`

## Phase 10 Outcome
- repeatable post-release canary and soak checks are documented against current host and federation health/metrics
- daily operational review, incident triage, and maintenance procedures are documented against the live API surface
