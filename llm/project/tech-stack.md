# ADHD Tech Stack (V2 Rebuild)

## Goal
Define the concrete stack for a from-scratch ADHD architecture built around Codex-native orchestration.

## Core Architecture Stack

### 1) Orchestration Service
- Runtime: Bun + TypeScript
- Responsibility:
  - Own the ADHD API and job lifecycle
  - Manage Codex app-server process/session
  - Translate Codex protocol events to ADHD job states
  - Persist job, event, and artifact metadata

Why: Fast iteration and strong TypeScript ergonomics for JSON-RPC and web APIs.

### 2) Codex Runtime Integration
- Primary binary: `codex`
- Primary control interface: `codex app-server` (experimental)
- Protocol style: JSON-RPC (v2 method family such as `thread/start`, `turn/start`, `turn/interrupt`)
- Tool extension interface: MCP via `codex mcp` + config `mcp_servers`

Why: Keeps orchestration on supported Codex-native interfaces instead of rebuilding a planner/runtime layer externally.

### 3) Delegation Model
- Preferred: Codex multi-agent roles (`[agents]` config + `multi_agent` feature)
- Fallback: ADHD-managed worker threads (or bounded `codex exec` jobs)

Why: Multi-agent matches the target UX, fallback keeps product reliability when experimental features change.

### 4) UI Surfaces
- Desktop control UI: web-first shell, then Tauri integration
- Mobile control UI: responsive web client against same ADHD API

Why: shared UI surface first, native shell after protocol/runtime stabilizes.

### 5) Speech Input
- Primary: OS-native dictation capture (desktop)
- Secondary: browser/mobile dictation input
- Both normalized into a single text contract before conductor submission

### 6) Data + Storage
- Primary: SQLite for jobs, state transitions, event stream snapshots, and run catalog
- Artifacts: local file storage for logs, summaries, and optional patches/diffs

Why: deterministic recovery and queryable history from day one.

## Policy Defaults
- Sandbox default: workspace-write equivalent
- Approval default: on-request (tightened for risky operations)
- Runtime limits:
  - max concurrent jobs
  - max worker count per job
  - per-job max runtime

All policy values are configurable and visible in ADHD diagnostics.

## Required Local Tooling
- Bun (runtime/scripts)
- Codex CLI (minimum pinned version to be defined in setup phase)
- Git/GitHub CLI where git workflows are enabled
- Optional MCP server dependencies based on enabled tools

## Codex Feature Expectations
- Required:
  - `mcp` command support
  - `app-server` command support
- Optional/experimental:
  - `multi_agent`

ADHD startup checks must detect and report these capabilities explicitly.

## Version and Compatibility Strategy
- Pin ADHD runtime dependencies in project manifests.
- Track tested Codex CLI version range in docs and diagnostics.
- Add protocol contract tests against generated app-server schema.
- Keep a compatibility matrix for:
  - `app-server` method availability
  - approval/sandbox behaviors
  - multi-agent support

## Security Notes
- ADHD does not attempt to replace Codex's approval/sandbox systems.
- ADHD adds orchestration-level controls:
  - which workspaces are addressable
  - what delegation modes are allowed
  - what operator actions are required before high-risk execution
