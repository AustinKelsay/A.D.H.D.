# Local Development Workflow (MVP)

## Purpose
Minimal recurring steps to run ADHD locally in MVP mode.

## Prerequisites
- Bun 1.x+
- Rust toolchain for Tauri
- `codex` CLI available on host PATH (or configured override)

## Setup
1. `bun install`
2. Confirm `bun run health`.

## Development
- Desktop: `bun run tauri:dev`
- Web/fallback: `bun run start`

## Daily checks
- Start orchestrator and verify it can:
  - detect host tools
  - create a single session
  - stream one session update

## Troubleshooting
- If host checks fail, verify PATH for `codex`, `git`, `gh`.
- Confirm `~/.adhd/` is writable.
