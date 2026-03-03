# ADHD Backlog (V2 Federated Rebuild)

## Legend
- Owner: `you`, `agent`, `shared`
- Size: `S` (<=1 day), `M` (1-3 days), `L` (3+ days)

## Phase 0: Setup Foundation

### ADHD2-001 Docs and contracts reset
- Owner: shared
- Size: S
- Depends on: none
- Done when:
  - docs reflect federated control-plane + host-node architecture

### ADHD2-002 Codex capability diagnostics
- Owner: agent
- Size: M
- Depends on: ADHD2-001
- Done when:
  - host diagnostics verify `codex app-server`, `codex mcp`, `codex mcp-server`
  - diagnostics report `multi_agent` availability

### ADHD2-003 Base schemas
- Owner: agent
- Size: M
- Depends on: ADHD2-001
- Done when:
  - schema includes host records and host-aware job fields (`hostId`, `hostJobId`)

### ADHD2-004 Compatibility harness
- Owner: agent
- Size: M
- Depends on: ADHD2-002
- Done when:
  - app-server schema snapshots are committed
  - compatibility checks fail fast on required API drift

## Phase 1: Session Runtime (Host-local)

### ADHD2-101 App-server process manager
- Owner: agent
- Size: L
- Depends on: ADHD2-002

### ADHD2-102 Protocol adapter v2
- Owner: agent
- Size: L
- Depends on: ADHD2-101

### ADHD2-103 Host-local job state machine
- Owner: agent
- Size: M
- Depends on: ADHD2-102

## Phase 2: Intent + Delegation

### ADHD2-201 Conductor prompt package
- Owner: you
- Size: M
- Depends on: ADHD2-103

### ADHD2-202 Multi-agent delegation path
- Owner: agent
- Size: L
- Depends on: ADHD2-201

### ADHD2-203 Fallback worker delegation path
- Owner: agent
- Size: L
- Depends on: ADHD2-201

### ADHD2-204 Delegation parity and kill-switch
- Owner: agent
- Size: M
- Depends on: ADHD2-202, ADHD2-203

## Phase 3: MVP (Single Host Baseline)

### ADHD2-301 Unified intake (voice + text)
- Owner: shared
- Size: M
- Depends on: ADHD2-103

### ADHD2-302 Live controls
- Owner: agent
- Size: M
- Depends on: ADHD2-301, ADHD2-201

## Phase 4: Mobile Control

### ADHD2-401 Mobile action parity
- Owner: agent
- Size: M
- Depends on: ADHD2-302

### ADHD2-402 Mobile auth and reconnect
- Owner: agent
- Size: M
- Depends on: ADHD2-401

## Phase 5: Multi-Host Federation

### ADHD2-501 Host registry and enrollment
- Owner: agent
- Size: L
- Depends on: ADHD2-302
- Done when:
  - control plane can register/revoke hosts with scoped auth

### ADHD2-502 Host heartbeat and capability sync
- Owner: agent
- Size: M
- Depends on: ADHD2-501
- Done when:
  - host online/degraded/offline state is reliable and visible

### ADHD2-503 Host routing and dispatch
- Owner: agent
- Size: L
- Depends on: ADHD2-502
- Done when:
  - operator can target host per job
  - dispatch and interrupt are host-aware

### ADHD2-504 Host outage handling
- Owner: agent
- Size: M
- Depends on: ADHD2-503
- Done when:
  - host outage handling is deterministic and test-covered

## Phase 6: Run Catalog

### ADHD2-601 Host-aware catalog schema
- Owner: agent
- Size: M
- Depends on: ADHD2-503

### ADHD2-602 Cross-host search and replay
- Owner: agent
- Size: M
- Depends on: ADHD2-601

## Phase 7: Reliability and Observability

### ADHD2-701 Recovery and reconciliation
- Owner: agent
- Size: L
- Depends on: ADHD2-602

### ADHD2-702 Drift and health automation
- Owner: agent
- Size: M
- Depends on: ADHD2-701

## Phase 8: Review and Hardening

### ADHD2-801 Safety and fallback hardening
- Owner: shared
- Size: M
- Depends on: ADHD2-702

## Phase 9: Release and Distribution

### ADHD2-901 Host bootstrap and upgrade runbook
- Owner: shared
- Size: M
- Depends on: ADHD2-801
