# ADHD Tech Stack (V2 Rebuild)

## Goal
Define the stack for a federated ADHD architecture: one control plane orchestrating multiple Codex host nodes.

## Core Architecture Stack

### 1) Control Plane Service
- Runtime: Bun + TypeScript
- Responsibilities:
  - operator API/UI
  - host registry and host health
  - job routing and global state
  - global catalog and policy management

### 2) Host Node Service
- Runtime: Bun + TypeScript (lightweight host agent)
- Responsibilities:
  - local Codex app-server process management
  - local job execution lifecycle
  - artifact capture and event streaming to control plane

### 3) Codex Runtime Integration
- Binary: `codex` (on each host)
- Control interface: `codex app-server` (experimental)
- Protocol: JSON-RPC methods like `initialize`, `thread/start`, `turn/start`, `turn/interrupt`
- Tool extension: MCP via `codex mcp` and `mcp_servers`

### 4) Delegation
- Preferred: `multi_agent` roles (when enabled)
- Fallback: host-managed worker threads / bounded `codex exec`

### 5) UI Surfaces
- Desktop and mobile clients talk to control plane
- Host selection and host health must be first-class in UX

### 6) Data and Storage
- Control plane SQLite:
  - hosts, jobs, routing decisions, global state timeline
- Host local storage:
  - logs, summaries, artifacts, host execution timeline

### 7) Control Plane <-> Host Transport
- Authenticated HTTPS + streaming channel (SSE/WebSocket)
- Host heartbeats with capability snapshots
- Signed host registration and revocation support

## Policy Defaults
- Manual host selection default
- Approval default: on-request
- Sandbox default: workspace-write equivalent
- Runtime caps:
  - per-host max concurrent jobs
  - per-job max workers
  - per-job timeout

## Required Tooling
- Control plane: Bun
- Host node: Bun + Codex CLI
- Optional host tools: git/gh + MCP server dependencies

## Compatibility Strategy
- Pin supported Codex versions per host profile
- Maintain host compatibility matrix for:
  - required app-server methods
  - notification families
  - `multi_agent` support
- Block host scheduling when compatibility checks fail

## Security Notes
- Control plane never executes code directly on remote host filesystems.
- Every host action is explicit, authenticated, and auditable.
- Host credentials/tokens are scoped and rotatable.
