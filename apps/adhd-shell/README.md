# ADHD Shell

Desktop-first Tauri v2 shell for the ADHD backend.

## Purpose
- establish the first real client boundary for ADHD
- operate desktop intake, job inspection, approvals, and results from a desktop shell
- provide the foundation for later mobile and dictation phases

## Local Commands
From repo root:

```bash
npm run shell:web
npm run shell:dev
npm run shell:build
npm run shell:test
npm run phase12:verify
```

## Default Local Backend Endpoints
- host: `http://127.0.0.1:8787`
- federation: `http://127.0.0.1:8788`

Start the backend separately with:

```bash
npm run local:up
```

## Current Desktop Surface
- host and federation health cards
- create-job intake form
- host target selection
- recent job list
- selected-job detail panel
- start, interrupt, retry, and retry-start actions
- approval and rejection controls
- result summary and artifact list
