# ADHD Intent Router Phase (Phase 2)

## Objective
Define conductor planning contracts and delegation behavior for host-local execution.

## In Scope
- input normalization
- conductor prompt package
- structured plan validation
- delegation policy (`multi_agent` vs fallback)
- API routes for normalization and plan inspection

## Work Items
1. Normalize voice/text to stable task object.
2. Version conductor prompt files.
3. Validate structured plan output before execution.
4. Enforce delegation mode policy and kill switch.
5. Include optional host constraints in plan metadata.
6. Persist intent/plan/delegation decision metadata on each created job.

## Exit Criteria
- same input yields reproducible plan shape
- invalid plans fail safely
- delegation mode is explicit and auditable

## Current Baseline Artifacts
- `src/intent/normalizer.js`
- `src/intent/prompts/conductor.v1.md`
- `src/intent/prompt-package.js`
- `src/intent/delegation-policy.js`
- `src/intent/plan-validator.js`
- `src/intent/router.js`
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
