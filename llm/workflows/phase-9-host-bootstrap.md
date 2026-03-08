# Phase 9 Runbook: Host Bootstrap, Upgrade, and Rollback

## Goal
Bring up a fresh control plane and host predictably, verify runtime readiness, and keep upgrade/rollback steps explicit.

## Compatibility Matrix
- Node.js: 18+
- Codex CLI: must support `app-server`, `mcp`, and `mcp-server`
- Required checks: `npm run health`, `npm run compat:check`
- Runtime smoke baseline: `node scripts/runtime-smoke.mjs`
- Optional deeper handshake check: `ADHD_RUNTIME_SMOKE_TIMEOUT_MS=60000 node scripts/runtime-smoke.mjs --initialize`

## 0. Verify Phase 9 Baseline
```bash
npm run phase9:verify
```

Expected:
- capability diagnostics pass for host and control-plane mode
- compatibility snapshot checks pass
- bounded runtime smoke succeeds

## 1. Fresh Host Bootstrap
Use different ports for the host API and federation API when running both locally. Examples below use `<HOST_PORT>=8787` and `<FEDERATION_PORT>=8788`.

1. Install dependencies:
```bash
npm install
```
2. Confirm Codex and host prerequisites:
```bash
npm run health
```
3. Start the host API:
```bash
PORT=<HOST_PORT> npm run host-api:start
```
4. Check host readiness:
```bash
curl -sS "http://127.0.0.1:<HOST_PORT>/health"
```

Expected:
- `runtime.ready` is `true`
- `workflow.preflight.ok` is `true`
- `workflow.status.loaded` is `true`

## 2. Fresh Control Plane Bootstrap
1. Start the federation API in a separate shell:
```bash
PORT=<FEDERATION_PORT> npm run federation-api:start
```
2. Check control-plane readiness:
```bash
curl -sS "http://127.0.0.1:<FEDERATION_PORT>/health" \
  -H "authorization: Bearer <CONTROL_PLANE_TOKEN>"
```

Expected:
- configured hosts appear in `hosts`
- online/degraded status is explicit
- workflow drift summary is present

## 3. Upgrade Checklist
Before upgrade:
- run `npm run phase9:verify`
- capture `/health` and `/metrics` from host and federation
- record current `WORKFLOW.md` content hash from host/federation health

Upgrade flow:
1. pull/update repo contents
2. run `npm install`
3. run `npm test`
4. restart host and control-plane services
5. re-run `npm run phase9:verify`

Accept upgrade only if:
- health endpoints are clean
- no unexpected workflow drift is reported
- runtime smoke still succeeds

## 4. Rollback Checklist
Use rollback when:
- runtime initialization fails after upgrade
- compatibility checks regress
- workflow drift or preflight failures block dispatch unexpectedly

Rollback flow:
1. return repo to previous known-good release/tag
2. run `npm install`
3. restore prior `WORKFLOW.md`
4. restart host and control-plane services
5. verify with `npm run phase9:verify`

## 5. First Job Readiness Gate
Before attempting the first production job:
- host `/health` is ready
- federation `/health` shows no unexpected offline/degraded host
- host `/metrics` shows no repeated workflow refresh or hook failures
- workflow refresh succeeds on demand

## 6. Release Checklist
Before cutting or deploying a release:
- run `npm run phase9:verify`
- confirm host and federation health are clean
- confirm no unexpected workflow drift
- confirm bootstrap/rollback owner and last-known-good revision are recorded
