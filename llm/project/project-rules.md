# ADHD Project Rules

## Purpose
Establish conventions for code structure, documentation quality, and execution safety in ADHD.

## Directory Map
```
llm/
├── README.md
├── project/
│   ├── project-overview.md
│   ├── user-flow.md
│   ├── tech-stack.md
│   ├── design-rules.md
│   ├── project-rules.md
│   └── phases/
│       ├── README.md
│       ├── setup-phase.md
│       ├── mvp-phase.md
│       └── review-and-hardening-phase.md (optional)
server.js
src-tauri/
public/
package.json
```

## Standards and Conventions
- Files should stay under 500 lines when possible.
- Function names should be descriptive and stateful with clear auxiliaries (`isLoading`, `hasError`, `isRunning`).
- Keep conditionals small and explicit.
- Functions should include short headers or doc comments.
- Prefer pure/functional composition at the boundaries where process orchestration is not stateful.
- Prefer pure/functional composition for orchestrator-provider adapters and template resolution.
- Prefer command handlers that fail fast and emit explicit errors.

## Session/Permission Conventions
- Default behavior uses host trust; no attempt to mirror enterprise policy.
- Orchestrator output must be normalized before execution: intent + chosen profile + safe command template.
- Every run gets:
  - `sessionId`
  - `profile` (`basic`, `edit`, `git`, `release`)
  - `orchestrator` (`provider`, `model`, `confidence`, `requiresConfirmation`, `traceId` when available)
  - `workingDirectory`
  - `state` lifecycle value
- Host-level destructive confirmation:
  - codex flags and risky workflow families must be visible before launch when running `release` profile.
- Confidence gating policy:
  - `basic` and `edit`: auto-run requires confidence >= 0.88.
  - `git`: auto-run requires confidence >= 0.93.
  - `release`: explicit confirmation always required before execution.
  - Missing or invalid confidence from the orchestrator is treated as invalid plan output and fails safely.
- UI must always display the active profile used for the session.
- Orchestrator provider and confidence details should be visible for non-trivial or failed planning attempts.

## Runtime Organization
- Runtime split:
  - Desktop-native orchestration and Tauri command handling in Rust.
  - Frontend in lightweight TS/JS for status and controls.
  - Reused dictation/runtime behavior from existing platform where available.
- Define stable internal contracts for:
  - session create
  - session status updates
  - output stream
  - session stop/retry/cancel

## Documentation Rules
- Any behavior-affecting change must update:
  - relevant `llm/project/*`
  - relevant `llm/implementation/*` notes
  - README if public command flows change
- Keep docs with current behavior only.

## Work Planning Rules
- Keep scope to one shippable increment per phase.
- Prefer explicit implementation acceptance criteria over vague milestones.
- If an API/contract changes, record command impact immediately before implementation.

## Testing and Quality Rules
- Startup checks are mandatory before major runner changes:
  - codex presence
  - profile schema validity
  - output capture path permissions
- For core paths, include:
  - queue transition tests
  - session cancel path
  - profile gating behavior

## Change Control Notes
- Reuse `dicktaint` runtime patterns where equivalent.
- Do not introduce new auth/security abstractions until the host-trust model is fully stabilized.
