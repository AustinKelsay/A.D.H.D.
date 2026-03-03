# ADHD Session Runtime Phase (Phase 1)

## Objective
Implement robust host-local Codex runtime orchestration through app-server.

## In Scope
- host-local app-server lifecycle
- typed protocol adapter
- host-local state transitions and interrupt behavior

## Work Items
1. Build host app-server process manager.
2. Implement typed JSON-RPC adapter.
3. Map protocol events to job states.
4. Implement deterministic interrupt/cancel handling.
5. Handle unknown notifications safely.

## Exit Criteria
- host can run job lifecycle end-to-end through app-server
- host-local transitions are deterministic and persisted
- required methods are checked at runtime
