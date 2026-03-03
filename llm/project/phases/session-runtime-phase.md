# ADHD Session Runtime Phase (Phase 1)

## Objective
Implement the Codex app-server bridge and map protocol events to ADHD job state transitions.

## In Scope
- App-server process lifecycle (start/restart/stop)
- JSON-RPC client adapter
- Core methods: `initialize`, `thread/start`, `turn/start`, `turn/interrupt`, `thread/read`
- Event ingestion and state mapping

## Out of Scope
- Final delegation strategy
- Mobile UX and advanced catalog search

## Work Items
1. Process manager
- Launch app-server in chosen transport mode (`stdio://` first, optional `ws://` later).

2. Protocol adapter
- Build typed request/response wrappers.
- Handle notification stream and correlation IDs.

3. State machine integration
- Map protocol signals into ADHD states (`planning`, `running`, etc.).
- Enforce legal transitions only.

4. Control actions
- Implement stop/interrupt flow from UI/API actions.

5. Error handling
- Classify protocol, transport, and runtime failures with clear remediation.
- Treat unknown/added app-server notifications as non-fatal unless they break required invariants.

## Exit Criteria
- At least one job can run from `queued` to terminal state entirely through app-server.
- Interrupt flow is deterministic and leaves no zombie state.
- State timeline is persisted for recovery work in later phases.
- Compatibility checks fail fast if required methods are missing at runtime.
