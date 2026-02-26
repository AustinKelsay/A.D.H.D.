# ADHD Release & Distribution Phase

## Goals
- Make deployment and onboarding repeatable for future machines.
- Preserve local-control model while reducing setup friction.

## Inputs
- `llm/project/project-overview.md`
- `llm/project/project-rules.md`
- `llm/project/phases/reliability-and-observability-phase.md`

## Scope
- In scope: release checklist, installer validation, upgrade strategy, migration notes.
- Out of scope: enterprise deployment and hosted service mode.

## Steps
1. **Release checklist**
   - Standardize checks for binaries, config migration, and profile defaults.
2. **Build validation**
   - Validate packaged Tauri build starts, discovers binaries, and passes smoke session test.
3. **Upgrade notes**
  - Define how profile/catalog schema changes migrate.
  - Include migration/rollforward guidance when `ADHD_ORCHESTRATOR_*` configuration changes provider.
4. **Distribution guidance**
   - Document macOS trust/security prompts and setup steps for first run.
5. **Rollback plan**
   - Define recovery steps if a new version blocks existing codex profiles or session state.

## Exit Criteria
- New machine can onboard in a documented, predictable path.
- Existing session data migration behavior is intentional and verified.
- Release checks fail fast with clear remediation text.
