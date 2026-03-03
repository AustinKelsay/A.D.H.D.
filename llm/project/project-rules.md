# ADHD Project Rules (V2 Federated)

## Purpose
Set implementation and documentation rules for federated multi-host ADHD.

## Runtime Rules
1. Codex-native control first
- Use app-server protocol as primary interface.
- Use `codex exec` only as explicit fallback.

2. Host-local execution only
- Jobs execute on their assigned host node only.
- Control plane does not run arbitrary shell commands on behalf of hosts.

3. Explicit policy and auth
- No silent sandbox/approval bypass.
- Host enrollment credentials must be revocable and scoped.

4. Stable method boundaries
- App-server integration behind typed adapter boundary.
- Required baseline: `initialize`, `thread/start`, `turn/start`, `turn/interrupt`, `thread/read`.

5. Experimental isolation
- `multi_agent` usage requires capability check, feature flag, and fallback path.

## Data Model Rules
Each job must include:
- `jobId`
- `hostId`
- `hostJobId` (or host correlation id)
- `threadId`
- `turnId`
- `delegationMode` (`multi_agent` or `fallback_workers`)
- `state`
- `policySnapshot`
- timestamps and terminal summary/artifact references

Each host record must include:
- `hostId`
- display name
- auth status
- heartbeat status
- capability snapshot
- version/compatibility status

## Testing Rules
Required coverage:
- protocol adapter tests
- state transition tests
- approval/interrupt tests
- host routing tests
- host offline/recovery tests
- restart reconciliation tests

Experimental paths require:
- delegation parity across `multi_agent` and `fallback_workers`
- compatibility checks against committed schema snapshots

## Documentation Rules
Behavior-affecting changes must update `llm/project/*` and relevant phase docs in the same change.
