# ADHD LLM Docs

## Purpose
Source of truth for project planning, conventions, and runbooks.

## Current milestone
- Setup phase is documented as complete and stabilized.
- Runtime implementation can begin from `llm/project/phases/session-runtime-phase.md` after handoff criteria are met.

## Folder Intent
- `project/` — canonical definitions (`project-overview`, `user-flow`, `tech-stack`, `design-rules`, `project-rules`).
- `project/` also defines orchestrator-provider planning assumptions for OpenAI-compatible backends.
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
- `project/phases/session-runtime-phase.md`
- `project/phases/mvp-phase.md`
- `project/phases/README.md`
- `project/phases/intent-router-phase.md`

## Quick Commands (Current)
- `bun install`
- `bun run docs:lint` (optional, recommended)
- `bun run health`
- `bun run start`
- `bun run tauri:dev`
- `bun run test`
