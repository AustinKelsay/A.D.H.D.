# ADHD Project Overview (V2 Rebuild)

> One-line purpose: ADHD is a voice-first control plane that turns dictation into managed Codex work across one or more trusted machines.

## Snapshot
- Project: ADHD — Agent Dictation Harness Delegator
- Rebuild mode: from-scratch implementation and docs reset
- Verified date: 2026-03-03 (US/Pacific)
- Deployment model: one ADHD control plane + one or more ADHD host nodes
- Primary execution engine: Codex CLI on each host node
- Primary control protocol: `codex app-server` JSON-RPC
- Tool integration path: MCP (`codex mcp`, `mcp_servers` in config)
- Delegation path: Codex multi-agent roles (experimental), with fallback worker execution

## Mission
Dictate once, delegate reliably, across machines.

You speak or type a task into ADHD. ADHD routes that task to a selected host node. That host runs a dedicated Codex conductor session (and workers) locally. ADHD provides unified control, approvals, and history from one app.

## Target Architecture
1. Input layer
- Desktop and phone clients submit tasks to ADHD control plane.

2. Control plane (central ADHD app)
- Owns operator UX, host registry, job routing, and global run catalog.
- Maintains policy defaults and per-host policy overrides.

3. Host nodes (one per machine)
- Each host runs its own local Codex runtime.
- Each host executes conductor/worker activity only on that local machine.

4. Codex bridge per host
- Host starts/owns `codex app-server`.
- Host maps `thread/start`, `turn/start`, `turn/interrupt`, and events into host-local execution state.

5. Delegation model per host
- Preferred path: multi-agent roles when enabled.
- Fallback path: host-managed worker threads or bounded `codex exec` jobs.

6. Tooling via MCP
- Hosts can expose/use MCP tools.
- Control plane can inspect host MCP capability and configuration status.

7. Persistence and observability
- Control plane stores global job state and host routing metadata.
- Hosts store execution artifacts and stream status back to control plane.

## Trust and Safety Model
- Trusted-owner model remains: all execution happens on owned machines.
- Control plane never assumes direct filesystem access across hosts.
- Host enrollment/authentication is explicit and revocable.
- Approval/sandbox policy is enforced per host with clear operator visibility.

## Canonical Job States
- `draft`
- `queued`
- `dispatching`
- `planning`
- `awaiting_approval`
- `delegating`
- `running`
- `summarizing`
- `completed`
- `failed`
- `cancelled`

## In Scope (V2)
- Single control plane with multi-host orchestration support.
- Manual host targeting first; optional auto-routing later.
- Desktop + phone controls across all registered hosts.
- Host-aware run catalog and replay.

## Out of Scope (V2)
- Multi-tenant SaaS control plane.
- Enterprise IAM and policy federation.
- Cross-host shared filesystem semantics.

## Success Criteria
- A task can be routed to Host A or Host B from the same app.
- Each host executes locally with accurate live status in one unified UI.
- Approval/interrupt/retry works per host from desktop and phone.
- Host outages degrade gracefully without corrupting global job state.

## Key Risks and Open Decisions
- `app-server` and `multi_agent` remain experimental; API churn is a risk.
- Need host enrollment/auth model (token vs mutual TLS).
- Need default routing policy (`manual_only` vs `least_busy` later).
- Need per-host compatibility checks and upgrade strategy.

## Experimental Churn Guardrails
1. Capability gate at startup
- Probe required methods/features on each host before accepting routed jobs.

2. Protocol contract snapshots
- Commit schema snapshots and compatibility manifests.

3. Adapter isolation
- Keep app-server changes isolated behind one adapter boundary.

4. Multi-agent kill switch
- Disable `multi_agent` per host instantly and route to fallback mode.

5. Parity tests
- Critical flows pass in both delegation modes on every supported host profile.

## Source References
- Codex MCP docs: https://developers.openai.com/codex/mcp
- Codex multi-agent docs: https://developers.openai.com/codex/multi-agent
- Codex app-server docs: https://developers.openai.com/codex/app-server
- Codex config reference: https://developers.openai.com/codex/config-reference
