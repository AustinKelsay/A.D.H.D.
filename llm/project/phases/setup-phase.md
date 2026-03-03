# ADHD Setup Phase (Phase 0)

## Objective
Stand up a clean V2 baseline with validated Codex capabilities, data contracts, and local runtime diagnostics.

## In Scope
- Rebuild-oriented docs alignment
- Codex capability checks (`app-server`, `mcp`, `mcp-server`)
- Base job/session schema for V2
- Local bootstrap commands and diagnostics

## Out of Scope
- Full protocol adapter implementation
- Delegation logic
- UI completion

## Work Items
1. Docs reset and contract freeze
- Replace legacy architecture assumptions with V2 control-plane assumptions.

2. Capability diagnostics
- Add startup checks for:
  - codex binary presence
  - `codex app-server --help`
  - `codex mcp --help`
  - `codex mcp-server --help`
  - optional `codex features list` multi-agent status

3. Data schema baseline
- Define required job/session fields for app-server orchestration.

4. Compatibility baseline
- Generate and commit app-server schema snapshots for the active Codex version.
- Create a compatibility manifest listing required methods and required notification families.

5. Bootstrap runbook
- One command path for startup + diagnostics + smoke check.

## Exit Criteria
- Diagnostics clearly report supported vs experimental Codex capabilities.
- V2 schema is committed and validated.
- Compatibility manifest and schema snapshot are committed.
- Phase 1 can start without unresolved setup ambiguity.
