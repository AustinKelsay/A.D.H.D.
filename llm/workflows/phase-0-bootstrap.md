# Phase 0 Bootstrap Runbook

## Purpose
Bootstrap the federated ADHD phase-0 baseline on a local machine.

## Prerequisites
- Node.js 18+ (for phase-0 scripts)
- Codex CLI available in PATH

## Commands
1. Install baseline project metadata (no dependencies currently):
```bash
npm install
```

2. Run host capability diagnostics:
```bash
npm run health
```

3. Generate app-server schema snapshot for current Codex version:
```bash
npm run compat:snapshot
```

4. Validate host/job schema requirements:
```bash
npm run schemas:check
```

5. Validate compatibility against baseline manifest:
```bash
npm run compat:check
```

6. Run docs presence checks:
```bash
npm run docs:lint
```

## Expected Artifacts
- `compatibility/latest.json`
- `compatibility/codex-app-server/<codex-version>/codex_app_server_protocol.schemas.json`
- `compatibility/codex-app-server/<codex-version>/methods.json`
- `compatibility/codex-app-server/<codex-version>/metadata.json`
