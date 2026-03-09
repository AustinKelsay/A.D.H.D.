# Phase 11 Runbook: Tauri Shell Bootstrap

## Goal
Bring up the ADHD Tauri shell scaffold against the existing host and federation APIs without requiring a full product UI yet.

## Scope
- desktop-first shell bootstrap
- local backend health inspection from the shell
- app-shell verification only

## 0. Verify Phase 11 Baseline
```bash
npm run phase11:verify
```

Expected:
- docs lint passes
- Phase 11 shell scaffold files are present and correctly wired

## 1. Start Local Backend
Use the simplified local backend path from the root README:

```bash
npm run local:up
```

If Codex startup is slow on the machine:

```bash
ADHD_RPC_REQUEST_TIMEOUT_MS=120000 npm run local:up
```

## 2. Shell Workspace Layout
Phase 11 app shell lives at:

- `apps/adhd-shell/`
- `apps/adhd-shell/src-tauri/`

This shell intentionally stays framework-light:
- Vite frontend
- Tauri v2 app shell
- direct health polling against host and federation APIs

## 3. Install App Dependencies
From repo root:

```bash
npm install
```

The shell workspace lives under the root npm workspaces config, so root install should hydrate the app dependencies too.

## 4. Start Frontend Dev Server
From repo root:

```bash
npm run shell:web
```

Expected:
- Vite serves the shell on `http://localhost:1420`

## 5. Start Tauri Dev Shell
From repo root:

```bash
npm run shell:dev
```

Expected:
- desktop shell launches
- shell renders backend readiness cards for:
  - host API (`127.0.0.1:8787`)
  - federation API (`127.0.0.1:8788`)

## 6. Local Overrides
Frontend defaults:
- host: `http://127.0.0.1:8787`
- federation: `http://127.0.0.1:8788`

Override via document metadata if the shell host config changes later:
- `adhd-host-base-url`
- `adhd-federation-base-url`

## 7. Phase 11 Done-For-Now Signal
Phase 11 bootstrap is functioning when:
- shell scaffold exists and passes `phase11:verify`
- local backend can be inspected from the shell
- the repo has an explicit client boundary to build desktop/mobile UI work on top of next
