# ADHD Project Overview (V2 Rebuild)

> One-line purpose: ADHD is a voice-first control layer that turns dictation into managed Codex work, using Codex's app-server and MCP interfaces as the core orchestration surface.

## Snapshot
- Project: ADHD — Agent Dictation Harness Delegator
- Rebuild mode: from-scratch implementation and docs reset
- Verified date: 2026-03-03 (US/Pacific)
- Primary execution engine: Codex CLI
- Primary control protocol: `codex app-server` JSON-RPC
- Tool integration path: MCP (`codex mcp`, `mcp_servers` in config)
- Delegation path: Codex multi-agent roles (experimental), with a stable fallback path

## Mission
Dictate once, delegate reliably.

You speak or type a task into ADHD. ADHD sends it to a dedicated Codex "conductor" session with strict system instructions. The conductor plans and delegates coding work to other Codex workers, while ADHD tracks state, approvals, logs, and outcomes in one control plane.

## What Changed From The Previous Plan
- Old plan: ADHD had its own orchestrator/provider layer in front of Codex.
- New plan: ADHD uses Codex-native orchestration surfaces directly:
  - `codex app-server` for session/thread/turn lifecycle
  - MCP for external tools and service bridges
  - multi-agent role spawning when enabled

This reduces custom planning infrastructure and keeps orchestration closer to the runtime that actually executes work.

## Target Architecture
1. Input layer
- Desktop and phone clients capture dictation/text and submit a job to ADHD.

2. ADHD control service
- Maintains job records, user actions, and UI-facing APIs.
- Hosts policy defaults (sandbox, approvals, allowed workspaces, runtime limits).

3. Codex bridge (core)
- ADHD starts/owns a `codex app-server` process.
- ADHD initializes a protocol session and creates a long-lived conductor thread.
- Job execution runs through `thread/start`, `turn/start`, `turn/interrupt`, and thread status events.

4. Conductor agent
- Conductor has a strict system prompt: plan, delegate, verify, summarize.
- It does not silently bypass approvals or sandbox policy.

5. Worker delegation
- Preferred path: Codex multi-agent roles via `[agents]` config and the `multi_agent` feature.
- Stable fallback path: ADHD creates separate worker threads (or `codex exec` jobs) per subtask and aggregates results back to conductor.

6. Tooling integration via MCP
- Codex can connect to ADHD-specific MCP servers (or other MCP servers) declared in config.
- ADHD can also expose MCP tools for task intake, run catalog lookup, and policy checks.

7. Persistence + observability
- ADHD stores job/session mappings (`jobId`, `threadId`, `turnId`, worker refs), event timelines, artifacts, and summaries.
- All critical transitions are replayable after restart.

## Trust and Safety Model
- Single-owner trusted machine model remains the default.
- ADHD still enforces explicit policy at orchestration boundaries:
  - approval mode defaults and escalation handling
  - sandbox mode defaults and per-job overrides
  - workspace boundaries and runtime limits
- Any feature marked experimental in Codex is wrapped with a fallback path and feature flag in ADHD.

## Canonical State Model
- `draft`: input captured, not yet submitted
- `queued`: accepted, waiting for Codex slot
- `planning`: conductor is interpreting request
- `awaiting_approval`: Codex requested approval/user input
- `delegating`: conductor is spawning/assigning workers
- `running`: at least one worker turn active
- `summarizing`: conductor preparing final output
- `completed`: final result delivered
- `failed`: terminal error
- `cancelled`: user or policy stop

## In Scope (V2)
- macOS-first rebuild with desktop + phone control surface
- Codex app-server integration as default runtime
- Dictation/text input to conductor-turn execution
- Worker delegation via multi-agent (flagged) or fallback worker threads
- MCP-backed tool extension points
- Job catalog with durable history

## Out of Scope (V2)
- Hosted multi-tenant ADHD service
- Enterprise IAM/policy engine
- Full autonomous background operation without user task input
- Non-Codex worker engines

## Success Criteria
- A spoken task can complete end-to-end through conductor + worker execution.
- ADHD can show true live status from Codex protocol events.
- Approval and interruption flows work from both desktop and phone.
- Multi-agent can be enabled safely, and fallback execution still works when disabled.
- Restart recovery restores active/incomplete jobs without data loss.

## Key Risks and Open Decisions
- `app-server` and `multi_agent` are currently documented as experimental surfaces; APIs may shift.
- Need a clear policy for when ADHD delegates via multi-agent vs fallback workers.
- Need to define minimum Codex version support and compatibility checks at startup.
- Need to choose default transport (`stdio://` vs `ws://127.0.0.1:PORT`) for the app-server bridge.

## Experimental Churn Guardrails
1. Capability gate at startup
- ADHD must probe required methods/features and block unsafe modes when unavailable.

2. Protocol contract snapshots
- Commit generated app-server JSON schema snapshots per supported Codex version.
- Run CI compatibility checks against those snapshots before release.

3. Adapter isolation
- Keep one internal adapter boundary so protocol changes are localized.
- Unknown notifications must be logged and ignored safely by default.

4. Multi-agent kill switch
- `multi_agent` can be disabled instantly via config/feature flag.
- Disabled or unsupported states must auto-route to fallback workers.

5. Parity tests
- Critical scenarios (plan, run, interrupt, summarize) must pass in both modes:
  - `delegationMode=multi_agent`
  - `delegationMode=fallback_workers`

## Source References
- Codex MCP docs: https://developers.openai.com/codex/mcp
- Codex multi-agent docs: https://developers.openai.com/codex/multi-agent
- Codex app-server docs: https://developers.openai.com/codex/app-server
- Codex config reference: https://developers.openai.com/codex/config-reference
