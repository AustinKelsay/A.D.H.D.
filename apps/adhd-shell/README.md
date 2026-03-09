# ADHD Shell

Desktop-first Tauri v2 shell for the ADHD backend.

## Purpose
- establish the first real client boundary for ADHD
- inspect host and federation readiness from a desktop shell
- provide the foundation for later desktop, mobile, and dictation phases

## Local Commands
From repo root:

```bash
npm run shell:web
npm run shell:dev
npm run shell:build
```

## Default Local Backend Endpoints
- host: `http://127.0.0.1:8787`
- federation: `http://127.0.0.1:8788`

Start the backend separately with:

```bash
npm run local:up
```
