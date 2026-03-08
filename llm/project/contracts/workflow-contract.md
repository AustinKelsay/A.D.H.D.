# ADHD Workflow Contract (`WORKFLOW.md`)

## Purpose
Define the repo-owned contract that controls conductor prompt behavior and host runtime policy.

`WORKFLOW.md` is the single source of truth for:
- prompt template content
- delegation/runtime defaults
- workspace hook lifecycle behavior
- host-side execution constraints used during dispatch preflight

## Scope
This contract is for ADHD host/control-plane orchestration, not multi-tenant workflow engines.

## File Resolution
Resolution order:
1. explicit runtime path (CLI flag or env)
2. repository `WORKFLOW.md`
3. process cwd `WORKFLOW.md` (fallback for local/dev)

If the workflow file is missing or invalid:
- dispatch/start preflight must fail safely
- service remains alive
- last-known-good workflow stays active for future eligible operations

## Format
`WORKFLOW.md` has:
- optional YAML front matter (config)
- markdown body (prompt template)

Top-level front matter sections:
- `prompt`
- `delegation`
- `codex`
- `hooks`
- `workspace`
- `routing` (optional phase-5+)

Unknown keys should be ignored for forward compatibility.

## Prompt Contract
Required behavior:
- template rendering is strict (unknown variables/filters are errors)
- template errors fail the affected run planning step deterministically
- invalid templates are never silently replaced by permissive defaults

Expected template context fields:
- `job`
- `intent`
- `plan`
- `host`
- `attempt`

## Runtime/Policy Contract
Workflow-configurable values (phase-dependent):
- delegation defaults (`defaultMode`, `allowMultiAgent`, `multiAgentKillSwitch`)
- Codex runtime policy defaults (approval/sandbox/timeouts)
- workspace root
- hook commands and hook timeout

Host safety invariants still apply:
- host-level kill-switch cannot be bypassed
- host capability floors cannot be escalated by request payload
- workspace path containment is required for hooks/launch

## Hook Lifecycle
Supported hooks:
- `after_create` (new workspace only)
- `before_run` (each attempt)
- `after_run` (best effort)
- `before_remove` (best effort)

Failure behavior:
- `after_create` and `before_run` failures block the attempt
- `after_run` and `before_remove` failures are logged and execution continues with cleanup policy
- hook output must be truncated/sanitized for logs

## Reload Semantics
Workflow reload is dynamic:
- config/prompt updates apply to future dispatch/attempts
- in-flight runs are not forcibly restarted unless policy explicitly requires it
- invalid reload events emit operator-visible errors and keep last-known-good workflow active

## Federation Semantics (Phase 5+)
Each host reports workflow identity:
- workflow version string and/or content hash
- last successful reload timestamp
- last reload error (if any)

Control plane uses this for:
- workflow drift visibility
- dispatch policy decisions for mismatched hosts

## Verification Expectations
Minimum tests for contract conformance:
- loader parse/validation success and failure surfaces
- strict template render errors
- last-known-good fallback on invalid reload
- hook timeout and failure semantics
- host workflow drift reporting (phase-5+)
