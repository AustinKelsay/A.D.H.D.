# ADHD LLM Docs

## Purpose
Source of truth for project planning, conventions, and runbooks.

## Folder Intent
- `project/` — canonical definitions (`project-overview`, `user-flow`, `tech-stack`, `design-rules`, `project-rules`, `phases`).
- `project/` files now also define orchestrator-provider planning assumptions for OpenAI-compatible backends.
- `context/` — focused reference docs for implementation and behavior decisions.
- `implementation/` — how current runtime behavior is implemented.
- `workflows/` — repeatable local/dev operations.

## Authoring Rules
- Keep files under 500 lines where practical.
- Keep docs in sync with behavior after each meaningful implementation change.
- Prefer explicit references to source files and scripts.

## Current Required Docs
- `project/project-overview.md`
- `project/user-flow.md`
- `project/tech-stack.md`
- `project/design-rules.md`
- `project/project-rules.md`
- `project/phases/setup-phase.md`
- `project/phases/mvp-phase.md`
- `project/phases/README.md`

## Quick Commands (Initial)
- `bun run start`
- `bun run tauri:dev`
- `bun run test`
