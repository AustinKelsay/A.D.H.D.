# ADHD Release and Distribution Phase (Phase 9)

## Status
Complete.

## Objective
Make new control-plane and host-node deployments repeatable.

## In Scope
- release checklist
- host compatibility matrix
- upgrade and rollback playbooks
- first-run onboarding for control plane and host nodes
- workflow authoring/versioning runbook (`WORKFLOW.md` templates, migration notes, rollback guidance)

## Exit Criteria
- a fresh control plane + fresh host can complete first job reliably
- upgrades are explicit, testable, and reversible
- operators can safely roll out and roll back workflow contract changes across hosts

## Delivered
- Phase 9 verification entrypoint (`npm run phase9:verify`) covering inherited regression tests, capability checks, and bounded runtime smoke
- host bootstrap, upgrade, and rollback runbook for control-plane and host bring-up
- workflow rollout and rollback runbook for staged `WORKFLOW.md` deployment
- federation regression proving a fresh control plane + fresh host can create, start, complete, and read back a first job

## Verification
- `npm run phase9:verify`
- `npm test`
