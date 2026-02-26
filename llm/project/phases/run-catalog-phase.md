# ADHD Run Catalog Phase

## Goals
- Make previous runs discoverable and actionable.
- Give users quick context on what was done, where, and with what outcome.

## Inputs
- `llm/project/project-overview.md`
- `llm/project/project-rules.md`
- `llm/project/phases/mvp-phase.md`

## Scope
- In scope: persisted session index, log indexing, search/filter, run links.
- Out of scope: advanced analytics dashboards or BI-style metrics.

## Steps (per feature)
1. **Catalog schema**
  - Persist session records with task text, profile, intent summary, provider/orchestrator metadata, timestamps, exit code, and artifacts.
2. **Log linkage**
   - Attach short output window + archived log location to each session.
3. **Search and filters**
   - Filter by state, profile, repo/path, and date range.
4. **Replay controls**
   - Add one-click rerun and clone-run action from completed/failure entries.
5. **Retention policy**
   - Define size/time retention for local logs and catalog entries.

## Exit Criteria
- Users can retrieve prior runs by text/state/profile quickly.
- Rerun/clone actions reproduce same profile context.
- Log locations are valid and readable after app restarts.
