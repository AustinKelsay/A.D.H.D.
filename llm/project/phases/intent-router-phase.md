# ADHD Intent Router Phase (Phase 2)

## Objective
Define conductor planning contracts and delegation behavior for host-local execution.

## In Scope
- input normalization
- conductor prompt package
- structured plan validation
- delegation policy (`multi_agent` vs fallback)

## Work Items
1. Normalize voice/text to stable task object.
2. Version conductor prompt files.
3. Validate structured plan output before execution.
4. Enforce delegation mode policy and kill switch.
5. Include optional host constraints in plan metadata.

## Exit Criteria
- same input yields reproducible plan shape
- invalid plans fail safely
- delegation mode is explicit and auditable
