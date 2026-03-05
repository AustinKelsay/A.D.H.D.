# ADHD Release and Distribution Phase (Phase 9)

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
