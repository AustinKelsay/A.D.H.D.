# ADHD Tech Stack

## Purpose
Define concrete technology choices and trade-offs for this phase of ADHD.

## Chosen Stack

### Frontend
- **Primary:** Vanilla TypeScript/ESM + lightweight custom UI (no framework initially).
- **Why:** Fastest setup in existing Tauri flow, minimal runtime overhead, easier portability for desktop + mobile web.
- **Alternative:** React + Vite.
- **Trade-off:** Better ecosystem and component reuse vs larger setup, more coupling, slower bootstrap for this MVP.

### Desktop Shell
- **Primary:** Tauri v2 with Rust backend (`src-tauri`), Bun for scripts/tasks.
- **Why:** Existing `dicktaint` foundation already uses this reliably with macOS-native capture and event bridge.
- **Alternative:** Electron.
- **Trade-off:** Better binary footprint and native-permission control vs larger compatibility surface.

### Backend Coordination
- **Primary:** Rust command layer for session lifecycle + an OpenAI-compatible orchestrator client, with `codex` process execution.
- **Why:** Good process control primitives and stable event emission for status updates.
- **Alternative:** Node child process orchestration with direct codex calls and separate planner script.
- **Trade-off:** Simpler single-language stack vs potentially fewer platform-specific integrations.

### Transport and State
- **Primary:** Tauri invoke for local controls + event channels for local UI updates.
- For phone control: local authenticated HTTP control surface with WebSocket/SSE streaming.
- **Alternative:** Poll-only API only.
- **Trade-off:** Real-time visibility vs easiest implementation path.

### Storage
- **Primary:** Local JSON config under `~/.adhd/` and optional session index file.
- **Alternative:** Embedded SQLite.
- **Trade-off:** Less operational complexity now; SQLite is better when session analytics/persistence grows.

### AI/Automation Tooling
- **Primary:** OpenAI-compatible orchestrator service for intent planning and command shaping (`ollama`, `openrouter`, `maple.ai`, or custom).
- **Execution path:** fixed `codex` CLI on the host for all code actions.
- **Why:** Keeps execution trust model stable while letting intent planning swap providers easily.
- **Alternative:** direct LLM-to-shell execution.
- **Trade-off:** More moving parts for planning, but better control and provider portability.

## Required Local Tooling
- Bun >= 1.0
- Rust toolchain matching Tauri 2 requirements.
- `codex` binary available on host PATH or configured override.
- `git` and `gh` available for the host workflows where needed.
- Planned `ADHD_ORCHESTRATOR_BASE_URL`/`ADHD_ORCHESTRATOR_MODEL` (and optional auth token) for the orchestrator provider.

## Version Strategy
- Pin project-level dependencies in `package.json` and `src-tauri/Cargo.toml`.
- Keep codex invocation templates versioned in repo docs and runtime config.
- Add health checks for minimum required binaries during startup.

## Security Implications of Stack
- Host trust model intentionally delegates authority to the existing machine setup.
- Security work is mostly transport + session gating, not local tooling duplication.

## Tooling Commands (Baseline)
- `bun run start` for local web server mode when needed.
- `bun run tauri:dev` for desktop iteration.
- Local health command (planned): `bun run adhd:health` to validate `codex`, `git`, `gh` availability.
