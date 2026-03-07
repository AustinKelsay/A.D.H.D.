# ADHD Run Catalog Phase (Phase 6)

## Objective
Provide durable, host-aware run history and replay workflows.

## In Scope
- durable control-plane run catalog (`run-catalog.v1`) persisted to disk
- catalog records include: `jobId`, `hostId`, `state`, `delegationMode`, `repoPath`, timestamps, replay source metadata
- cross-host search filters: `hostId`, `state`, `repo`, `from`, `to`, `q`, `limit`, `offset`
- replay workflows:
  - rerun existing run on original host (`POST /api/jobs/:jobId/rerun`)
  - clone run into a new job while preserving original host by default (`POST /api/jobs/:jobId/clone`)

## Exit Criteria
- operators can find and replay jobs across hosts quickly
- host linkage remains correct after restarts
- control plane can return run history even if host runtime no longer has the live job record

## API Surface (Phase 6)
- `GET /api/jobs`
  - returns catalog-backed jobs and catalog metadata
  - syncs live host jobs into catalog opportunistically
  - supports filters above and pagination payload
- `GET /api/jobs/:jobId`
  - returns live host job when available
  - falls back to persisted catalog snapshot when live record is unavailable
- `POST /api/jobs/:jobId/rerun`
  - retries the same job on the routed host (`startNow` defaults true)
  - optional fallback to clone behavior when original host record is missing (`cloneIfMissing`)
- `POST /api/jobs/:jobId/clone`
  - clones historical job input/intent/plan into a new host job
  - defaults to original `hostId`, optional override if explicitly provided

## Config
- `ADHD_FED_CATALOG_PATH` (default: `.adhd/federation-run-catalog.json` under process cwd)
