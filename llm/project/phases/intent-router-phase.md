# ADHD Intent Router Phase (Phase 2)

## Objective
Define conductor planning contracts and delegation behavior for host-local execution.

## In Scope
- input normalization
- conductor prompt package
- structured plan validation
- delegation policy (`multi_agent` vs fallback)
- API routes for normalization and plan inspection
- workflow-driven prompt template rendering with strict variable/contract checks

## Work Items
1. Normalize voice/text to stable task object.
2. Version conductor prompt files and map them into `WORKFLOW.md` prompt contract.
3. Validate structured plan output before execution.
4. Enforce delegation mode policy and kill switch.
5. Include optional host constraints in plan metadata.
6. Persist intent/plan/delegation decision metadata on each created job.
7. Fail fast on workflow template parse/render errors (no silent prompt fallback for invalid templates).

## Exit Criteria
- same input yields reproducible plan shape
- invalid plans fail safely
- delegation mode is explicit and auditable
- workflow template rendering is strict and deterministic

## Current Baseline Artifacts
- `src/intent/normalizer.js`
- `src/intent/prompts/conductor.v1.md`
- `src/intent/prompt-package.js`
- `src/intent/delegation-policy.js`
- `src/intent/plan-validator.js`
- `src/intent/router.js`
- `config/schemas/intent.schema.json`
- `config/schemas/plan.schema.json`
- `src/server/host-api.js`
- `test/intent-normalizer.test.js`
- `test/intent-router.test.js`
- `test/host-api.test.js`

## API Surface (Phase 2 Additions)
- `POST /api/intent/normalize`
- `POST /api/intent/plan`
- `POST /api/jobs` now attaches:
  - `intent` (`intent.v1`)
  - `plan` (`plan.v1`)
  - `delegationDecision` (auditable selected mode + reason)

## Verification Commands
- `npm test`
- `npm run phase2:verify`

## Operator Knobs
- Host capability env:
  - `ADHD_HOST_MULTI_AGENT=true|false`
- Host default delegation policy env:
  - `ADHD_DELEGATION_DEFAULT_MODE=multi_agent|fallback_workers`
  - `ADHD_DELEGATION_ALLOW_MULTI_AGENT=true|false`
  - `ADHD_MULTI_AGENT_KILL_SWITCH=true|false`
- Per-request policy payload fields (`POST /api/intent/plan`, `POST /api/jobs`):
  - `delegationPolicy.defaultMode`
  - `delegationPolicy.allowMultiAgent`
  - `delegationPolicy.multiAgentKillSwitch`
- Safety behavior:
  - Host defaults are enforced as the minimum-safe policy.
  - A host-level `multiAgentKillSwitch=true` cannot be disabled by request payload.
