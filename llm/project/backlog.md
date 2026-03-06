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

### ADHD2-005 Workflow contract baseline
- Owner: shared
- Size: M
- Depends on: ADHD2-001
- Done when:
  - `WORKFLOW.md` contract (prompt/runtime/hooks) is documented
  - workflow parse/validation error semantics are defined

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

### ADHD2-104 Workflow hook lifecycle
- Owner: agent
- Size: M
- Depends on: ADHD2-103
- Done when:
  - host executes `after_create`, `before_run`, `after_run`, `before_remove` hooks with timeout controls
  - workspace safety boundaries are enforced for hook execution

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

### ADHD2-205 Workflow prompt rendering contract
- Owner: agent
- Size: M
- Depends on: ADHD2-201
- Done when:
  - conductor prompt is sourced from workflow contract
  - template parse/render failures are surfaced deterministically

## Phase 3: MVP (Single Host Baseline)

### ADHD2-301 Unified intake (voice + text)
- Owner: shared
- Size: M
- Depends on: ADHD2-103

### ADHD2-302 Live controls
- Owner: agent
- Size: M
- Depends on: ADHD2-301, ADHD2-201

### ADHD2-303 Workflow preflight and reload
- Owner: agent
- Size: M
- Depends on: ADHD2-205
- Done when:
  - dispatch preflight validates workflow/runtime requirements
  - invalid reload keeps last-known-good workflow active

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

### ADHD2-505 Cross-host workflow parity
- Owner: agent
- Size: M
- Depends on: ADHD2-503
- Done when:
  - control plane surfaces per-host workflow version/hash
  - dispatch policy for workflow drift is explicit and test-covered

## Phase 6: Run Catalog

### ADHD2-601 Host-aware catalog schema
- Owner: agent
- Size: M
- Depends on: ADHD2-503
- Status: done
- Done when:
  - control plane persists host-aware run catalog entries (`jobId`, `hostId`, state/timestamps, replay source)
  - host linkage is restored from catalog after control-plane restart

### ADHD2-602 Cross-host search and replay
- Owner: agent
- Size: M
- Depends on: ADHD2-601
- Status: done
- Done when:
  - operators can filter catalog by host/state/repo/date and query text
  - rerun and clone replay routes preserve host context by default

## Phase 7: Reliability and Observability

### ADHD2-701 Recovery and reconciliation
- Owner: agent
- Size: L
- Depends on: ADHD2-602
- Status: done
- Done when:
  - host outage handling is deterministic for dispatch/start/retry paths
  - reconciliation surfaces blocked non-terminal jobs during host degradation/offline windows
  - behavior is covered by federation route tests

### ADHD2-702 Drift and health automation
- Owner: agent
- Size: M
- Depends on: ADHD2-701
- Status: done
- Done when:
  - control plane and host expose structured metrics snapshots for operational debugging
  - host workflow drift detection policy is explicit (`warn` / `block_dispatch`) and enforced
  - compatibility drift checks are included in phase verification (`phase7:verify`)

### ADHD2-703 Workflow reload observability
- Owner: agent
- Size: M
- Depends on: ADHD2-303
- Status: done
- Done when:
  - workflow reload success/failure and active version are visible in logs/metrics
  - operators can trigger/verify workflow refresh safely

## Phase 8: Review and Hardening

### ADHD2-801 Safety and fallback hardening
- Owner: shared
- Size: M
- Depends on: ADHD2-702
- Status: done
- Done when:
  - host auth, isolation, and fallback edge cases are covered by host/federation tests
  - unsafe or unready workflow/runtime states fail closed without widening privileges

### ADHD2-802 Workflow hook hardening
- Owner: shared
- Size: M
- Depends on: ADHD2-703
- Status: done
- Done when:
  - hook output/secret hygiene guardrails are enforced
  - malformed/unsafe workflow changes fail closed for dispatch
  - workspace hook lifecycle is covered for create/start/terminal/cleanup paths

## Phase 9: Release and Distribution

### ADHD2-901 Host bootstrap and upgrade runbook
- Owner: shared
- Size: M
- Depends on: ADHD2-801
- Status: done
- Done when:
  - operators have a single runbook for first host bootstrap, upgrade, and rollback
  - release verification includes control-plane/host capability checks plus bounded runtime smoke

### ADHD2-902 Workflow rollout runbook
- Owner: shared
- Size: M
- Depends on: ADHD2-802
- Status: done
- Done when:
  - operators can version, stage, and roll back workflow changes across hosts
  - workflow rollout verification uses drift/health checks before and after refresh
