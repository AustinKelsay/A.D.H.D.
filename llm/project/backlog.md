# ADHD Backlog (V2 Rebuild)

## Legend
- Owner: `you`, `agent`, `shared`
- Size: `S` (<=1 day), `M` (1-3 days), `L` (3+ days)

## Phase 0: Foundation

### ADHD2-001 Initialize rebuild docs and contracts
- Owner: shared
- Size: S
- Depends on: none
- Done when:
  - project and phase docs reflect V2 architecture
  - old planner-provider assumptions are removed or marked legacy

### ADHD2-002 Codex capability diagnostics
- Owner: agent
- Size: M
- Depends on: ADHD2-001
- Done when:
  - startup checks verify `codex app-server`, `codex mcp`, `codex mcp-server`
  - diagnostics report experimental feature availability (`multi_agent`)

### ADHD2-003 Base data schema
- Owner: agent
- Size: M
- Depends on: ADHD2-001
- Done when:
  - job/session schema includes `jobId`, `threadId`, `turnId`, `delegationMode`, `policySnapshot`
  - schema validation fails loudly on missing required fields

### ADHD2-004 Protocol compatibility harness
- Owner: agent
- Size: M
- Depends on: ADHD2-002
- Done when:
  - app-server JSON schema snapshots are generated and committed for supported Codex versions
  - CI diff checks fail on incompatible protocol shape changes without explicit adapter updates

## Phase 1: App-Server Runtime

### ADHD2-101 Build app-server process manager
- Owner: agent
- Size: L
- Depends on: ADHD2-002
- Done when:
  - ADHD can start/stop/reconnect a codex app-server process
  - stdio and ws transport modes are both supported behind one adapter

### ADHD2-102 Implement protocol adapter (v2)
- Owner: agent
- Size: L
- Depends on: ADHD2-101
- Done when:
  - adapter supports initialize, thread/start, turn/start, turn/interrupt, thread/read
  - notifications are streamed into typed event handlers

### ADHD2-103 Job state machine integration
- Owner: agent
- Size: M
- Depends on: ADHD2-102
- Done when:
  - ADHD job states map deterministically from protocol events
  - invalid transitions are blocked with typed errors

## Phase 2: Conductor + Delegation

### ADHD2-201 Conductor prompt and plan contract
- Owner: you
- Size: M
- Depends on: ADHD2-103
- Done when:
  - conductor system/developer prompts are versioned in repo
  - structured plan output contract is validated before execution

### ADHD2-202 Multi-agent delegation path
- Owner: agent
- Size: L
- Depends on: ADHD2-201
- Done when:
  - ADHD can run a job through Codex multi-agent when feature is enabled
  - role map and runtime limits are configurable

### ADHD2-203 Fallback worker delegation path
- Owner: agent
- Size: L
- Depends on: ADHD2-201
- Done when:
  - ADHD can complete the same delegation scenarios without multi-agent
  - fallback is automatic when capability check fails

### ADHD2-204 Delegation parity and kill-switch tests
- Owner: agent
- Size: M
- Depends on: ADHD2-202, ADHD2-203
- Done when:
  - critical flows pass in both modes (`multi_agent`, `fallback_workers`)
  - disabling `multi_agent` at runtime routes all new jobs to fallback with no manual intervention

## Phase 3: Dictation + UI MVP

### ADHD2-301 Unified task intake (voice + text)
- Owner: shared
- Size: M
- Depends on: ADHD2-103
- Done when:
  - voice and text inputs share one normalized job contract
  - both desktop and phone can submit jobs

### ADHD2-302 Live run controls
- Owner: agent
- Size: M
- Depends on: ADHD2-301, ADHD2-201
- Done when:
  - UI supports start, approve/reject, interrupt, retry
  - state updates stream in near real-time

## Phase 4: MCP Tooling

### ADHD2-401 ADHD MCP server for internal tools
- Owner: agent
- Size: L
- Depends on: ADHD2-201
- Done when:
  - Codex can call ADHD MCP tools for run lookup/policy context
  - tool calls are audited and access-scoped

### ADHD2-402 MCP server management UX
- Owner: you
- Size: M
- Depends on: ADHD2-401
- Done when:
  - users can inspect configured MCP servers/status in ADHD diagnostics

## Phase 5: Reliability + Release

### ADHD2-501 Restart recovery and reconciliation
- Owner: agent
- Size: L
- Depends on: ADHD2-302
- Done when:
  - in-flight jobs recover cleanly after ADHD restart
  - stale job handling is deterministic and test-covered

### ADHD2-502 Hardening and release checklist
- Owner: shared
- Size: M
- Depends on: all MVP-critical tickets
- Done when:
  - protocol, approval, and fallback paths pass release sweeps
  - onboarding checklist is reproducible on a new machine
