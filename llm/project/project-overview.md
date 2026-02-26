# ADHD Project Overview

> One-line purpose: A Tauri orchestration layer that turns voice instructions into managed codex CLI sessions on one trusted machine.

## Snapshot
- **Project:** ADHD — Agent Dictation Harness Delegator
- **Type:** Voice-driven agent orchestrator and session control surface
- **Primary stack:** Bun/TypeScript frontend with Rust/Tauri backend (macOS desktop first), provider-pluggable orchestrator with fixed `codex` CLI execution
- **Approach:** Documentation-first setup from `plebdev/new-project-boilerplate`, with `dictation` foundations for native dictation/runtime ergonomics

## Mission
Enable one machine to act as a trusted orchestration host for coding tasks. The orchestrator is an intelligent planning layer and the execution worker is always `codex`.
  
You should be able to dictate from desktop or phone, have ADHD convert speech into a codex task, launch codex instances, and track status/output from a single interface.

## What this project solves
- Remove friction between “dictate a request” and “execute in codex.”
- Keep a clear session model for concurrent agent work instead of ad-hoc terminal commands.
- Make git/code actions discoverable and traceable while preserving your existing local machine setup.

## Core use cases
- “Open this repo, implement change X, run tests, and summarize.”
- “Start two parallel codex jobs with different profiles.”
- “From my phone, check the current run list and stop a stuck session.”
- “Run git and GitHub actions from the same orchestrator using my existing `gh` auth.”

## User model
- Primary user: one owner running a local development machine.
- Trusted environment: local host already owns codex, git, gh credentials, and sandboxing preferences.
- Access clients: desktop UI (same host) and mobile UI (remote control over a secure channel).

## Architecture (intent)
- **Orchestrator host:** the desktop machine runs ADHD, hosts the session/runtime control plane, and executes `codex` commands.
- **Client surface:** desktop and phone present the same controls (sessions, status, logs, quick actions).
- **Intent bridge:** dictation and task text land in a shared intent queue.
- **Orchestrator agent:** an OpenAI-compatible planning layer transforms task intent into constrained execution specs and required codex arguments.
- **Provider adapter:** swappable planning backends (`ollama`, `openrouter`, `maple-ai`, or custom OpenAI-compatible endpoint).
- **Session runner:** one codex process per job, with profile + timeout + working directory + output stream.
- **Session registry:** in-memory and persisted index of each run (state, outputs, exit code, errors).

## Security policy: lightweight and practical
ADHD is built on **host-trust**:
- If your machine can run it, codex can run it.
- ADHD defaults to reusing existing toolchain permissions, `PATH`, credentials, and environment.
- No broad sandbox policy rewrite inside ADHD.
- Planner output is validated before execution and never executed directly as shell.

Session-level permission control is intentionally simple:
1. **Profile mode** per session (`basic`, `edit`, `git`, `release`).
2. Profiles map to codex flags/env overrides.
3. Higher-risk profiles can be set explicitly by command (e.g., “start this in `git` mode”).
4. Destructive operations can optionally require one-step confirmation before launch.

Default behavior:
- `basic`: explore/read/summarize tasks.
- `edit`: editing and refactor tasks.
- `git`: `git/gh` operations and local workflow tasks.
- `release`: broader tool usage with explicit confirmation gates.

This avoids duplicating your machine trust model while still giving runtime control from each session.

## Reuse from `dictation`
- `src-tauri` shell and command/event wiring model.
- Runtime branching for native + web paths.
- Local state/config conventions and SPA-safe serving.
- Hotkey/setup/session-state patterns that already work in your existing desktop environment.

## New ADHD capabilities
- Intention extraction from speech and UI text for codex tasks.
- Provider-pluggable orchestrator planning via OpenAI-compatible APIs.
- Multi-session codex orchestration (queueing, running, cancellation, retries).
- Session-level profiles and logs for traceability.
- Optional dependency sequencing: simple chain mode (A then B).
- Built-in run catalog with transcript + intent + stdout/stderr + exit metadata.

## In scope
- macOS Tauri MVP, local desktop host.
- Voice entry from native dictation on desktop and fallback browser dictation on phone.
- Manual phone + desktop session control.
- Up to N concurrent jobs with practical guardrails.
- Git/GitHub command flows using existing local `gh`, `git`, codex setup.

## Out of scope
- Building an enterprise permission engine from scratch.
- Cross-machine policy replication or centralized identity system.
- Windows/Android parity in MVP.
- Self-initiating agents without user-provided intent.

## Target architecture decisions
- Keep the web/API surface intentionally small.
- Prefer explicit, testable commands over hidden heuristics.
- Keep orchestration logic in Rust command layer; keep UI focused on status/control.
- Treat transcripts and run metadata as local artifacts unless user exports them.

## Success criteria
- End-to-end voice-to-job path works from desktop and phone.
- Session list always reflects true runner state (`queued`, `awaiting_confirmation`, `starting`, `running`, `completed`, `failed`, `cancelled`).
- Job output is streamed and persisted with IDs and timestamps.
- Session profiles are visible and adjustable before launch.
- Git-related jobs can complete using existing host auth without extra account flows.

## Constraints
- Speech is not perfect; confirmation and rerun are needed for critical jobs.
- Codex version/flags can vary; ADHD stores command profile templates and validates invocation.
- Remote access increases attack surface; channel security and token/session scope remain critical.
- Concurrent jobs share host resources and should be capped by configuration.
- Provider availability, auth, and latency failures must be surfaced as explicit, user-actionable errors.
- Planner confidence is explicit by profile: `release` is always manual confirm; `git` requires higher confidence to auto-run than `basic/edit`.

## Roadmap
### Phase 0 — Setup
- Establish `llm/project/*` docs baseline and confirm app shell.
- Add host checks for `codex`, `git`, and `gh`.
- Define session and profile schema.

### Phase 1 — Session Runtime
- Implement deterministic session lifecycle (`queued`, `awaiting_confirmation`, `starting`, `running`, `completed`, `failed`, `cancelled`).
- Add codex process orchestration and cancellation.
- Add max-concurrency and queue control.

### Phase 2 — Intent Router
- Convert transcript/text input to normalized task objects.
- Add an OpenAI-compatible orchestrator adapter layer before profile-aware template mapping.
- Show launch preview for risky commands.

### Phase 3 — MVP
- Deliver desktop and phone session list/control.
- Stream session output and completion summaries.
- Persist run records and status transitions.

### Phase 4 — Mobile Control and Auth
- Add paired token authorization for remote control.
- Ensure cross-device action parity (`start`, `cancel`, `retry`).
- Add reconnect-safe session polling/stream behavior.

### Phase 5 — Catalog and Observability
- Add searchable run catalog and log retention policy.
- Add deterministic error taxonomy and richer diagnostics.
- Add startup recovery and stale-session reconciliation.
- Store planner provider latency/error details with each completed/failed run.

### Phase 6 — Review and Release
- Run edge-case hardening sweep.
- Freeze profile behavior and publish release checklist.
- Document migration steps and known operational limits.

## Open decisions
- Decide whether profile allowlist should stay hard-coded or move to configurable YAML in the first pass.
- Decide whether phone control should stay LAN-only in MVP or support relay immediately (Tailscale/WireGuard).
- Decide whether desktop should remain the primary authority with phone as read/write control or permit equal control roles.
- Decide whether confidence thresholds should stay fixed constants or become configurable before launch.
- Default ordering currently prioritizes the `ollama` provider.
- Failure mode today causes the orchestrator/provider layer to hard-fail.
- Confidence rules are: `basic` and `edit` require >=0.88 to auto-run, `git` requires >=0.93, and `release` always requires confirmation.
- Confidence below threshold places the session in blocked-awaiting-confirmation state until user override.
