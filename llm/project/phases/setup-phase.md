# ADHD Setup Phase (Phase 0)

## Objective
Establish the federated baseline: control-plane contracts, host-node contracts, and compatibility diagnostics.

## In Scope
- docs and contract reset
- host and Codex capability checks
- host-aware schema baseline
- compatibility manifest + schema snapshots

## Work Items
1. Define control-plane and host-node responsibilities.
2. Add diagnostics for host Codex capabilities.
3. Define host record and host-aware job schema.
4. Commit compatibility baseline artifacts.
5. Publish bootstrap runbook for control plane and host node.

## Exit Criteria
- setup docs are consistent with federated architecture
- host-aware schemas are validated
- compatibility artifacts are committed

## Current Baseline Artifacts
- `config/schemas/host.schema.json`
- `config/schemas/job.schema.json`
- `compatibility/compatibility-manifest.json`
- `compatibility/required-methods.json`
- `compatibility/latest.json`
- `compatibility/codex-app-server/<codex-version>/codex_app_server_protocol.schemas.json`
- `compatibility/codex-app-server/<codex-version>/methods.json`

## Verification Commands
- `npm run health`
- `npm run schemas:check`
- `npm run compat:snapshot`
- `npm run compat:check`
- `npm run phase0:verify`
