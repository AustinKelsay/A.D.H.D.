# ADHD Run Catalog Phase (Phase 5)

## Objective
Persist and expose job history that is useful for replay, auditing, and recovery.

## In Scope
- Persistent job index with thread/turn linkage
- Search/filter by state/date/repo/delegation mode
- Rerun and clone-run entry points

## Out of Scope
- BI dashboards

## Work Items
1. Catalog schema finalization
- Store conductor + worker references, policy snapshot, artifacts, terminal summary.

2. Search and filters
- Add operator-centric filters and quick lookup.

3. Replay operations
- Implement rerun/clone using stored normalized input and policy defaults.

4. Retention policy
- Define expiration/cleanup strategy for logs and artifact files.

## Exit Criteria
- Operators can quickly find and replay historical jobs.
- Catalog survives restarts and remains internally consistent.
