# A.D.H.D.

Local-first host and federation control-plane runtime for Codex-driven job orchestration.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Check local prerequisites
```bash
npm run health
```

This must pass first. The local runtime expects a working `codex` CLI.

### 3. Run the one-command local smoke test
```bash
npm run local:smoke
```

What this does:
- starts the host API on `127.0.0.1:8787`
- starts the federation API on `127.0.0.1:8788`
- bootstraps one local federation host (`h_alpha01`) automatically
- waits for both `/health` endpoints to become ready
- creates and starts one federated job
- verifies the job can be read back through the control plane
- shuts everything down automatically

If this passes, your local baseline is working.

If it fails with `Host runtime is not ready`, the APIs are up but Codex runtime initialization did not complete in time. Use:

```bash
ADHD_RPC_REQUEST_TIMEOUT_MS=120000 npm run local:smoke
```

If you want the deeper RPC handshake diagnostic directly, use:

```bash
ADHD_RUNTIME_SMOKE_TIMEOUT_MS=60000 node scripts/runtime-smoke.mjs --initialize
```

Use `npm run local:up` if you still want the APIs running for inspection while you debug runtime startup.

## Keep The Stack Running

If you want both services left running for manual testing:

```bash
npm run local:up
```

That keeps the host API and federation API running in one terminal and prints the health and metrics URLs. Stop both with `Ctrl-C`.
It also bootstraps the default local federation host so you can submit jobs immediately.

## Default Local URLs

- Host API: `http://127.0.0.1:8787`
- Federation API: `http://127.0.0.1:8788`

Useful checks:

```bash
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8788/health
curl -sS http://127.0.0.1:8787/metrics
curl -sS http://127.0.0.1:8788/metrics
```

## Most Useful Commands

- `npm run local:smoke`
  - one-command bring-up, health verification, and basic end-to-end smoke
- `npm run local:up`
  - keep both local services running for manual exploration
- `npm run shell:web`
  - run the Phase 12 desktop client in the browser against the local backend
- `npm run shell:dev`
  - launch the native Tauri desktop shell
- `npm run health`
  - verify local runtime prerequisites
- `npm run phase12:verify`
  - verify the desktop client, frontend tests, and Tauri/Rust compile path
- `npm run phase10:verify`
  - run the full project verification chain

## Local Configuration

You usually do not need any environment variables for the first run.

Optional overrides:

- `ADHD_HOST_PORT`
  - host API port, default `8787`
- `ADHD_FEDERATION_PORT`
  - federation API port, default `8788`
- `ADHD_FED_HOSTS`
  - host IDs exposed by the local federation runtime, default `h_alpha01`
- `ADHD_RPC_REQUEST_TIMEOUT_MS`
  - JSON-RPC request timeout for local host/federation startup, default `60000` in the simplified local scripts
- `ADHD_WORKFLOW_PATH`
  - override the `WORKFLOW.md` path

Example:

```bash
ADHD_HOST_PORT=9001 ADHD_FEDERATION_PORT=9002 npm run local:smoke
```

## Manual API Flow

After `npm run local:up`, create and start a federated job with:

```bash
curl -sS -X POST http://127.0.0.1:8788/api/jobs \
  -H 'content-type: application/json' \
  -d '{
    "hostId": "h_alpha01",
    "inputText": "Summarize the server modules in ./src/server"
  }'
```

Then:

```bash
curl -sS -X POST http://127.0.0.1:8788/api/jobs/<jobId>/start \
  -H 'content-type: application/json' \
  -d '{}'
```

And inspect it:

```bash
curl -sS http://127.0.0.1:8788/api/jobs/<jobId>/live
curl -sS http://127.0.0.1:8788/api/jobs/<jobId>/result
```

## Desktop Client

After `npm run local:up`, you can use the Phase 12 desktop client instead of `curl`.

Browser shell:

```bash
npm run shell:web
```

Native Tauri shell:

```bash
npm run shell:dev
```

The desktop client currently includes:
- host and federation health cards
- create-job intake form
- host selection
- recent jobs list
- selected-job detail view
- start, interrupt, retry, and retry-start actions
- approval and rejection actions
- result summary and artifact listing

## Deeper Runbooks

For rollout, hardening, and operations details:

- [Phase 9 Bootstrap](./llm/workflows/phase-9-host-bootstrap.md)
- [Phase 9 Rollout](./llm/workflows/phase-9-workflow-rollout.md)
- [Phase 10 Operations](./llm/workflows/phase-10-operations-operator.md)
- [Phase 11 Shell Bootstrap](./llm/workflows/phase-11-tauri-shell-bootstrap.md)
- [Phase 12 Desktop Client](./llm/workflows/phase-12-desktop-client-operator.md)
