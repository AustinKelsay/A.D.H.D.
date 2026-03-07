# ADHD Review and Hardening Phase (Phase 8)

## Status
Complete.

## Objective
Reduce release risk across safety, fallback, and multi-host edge cases.

## In Scope
- edge-case lifecycle testing
- host auth and isolation checks
- delegation parity and kill-switch drills
- documentation/runbook alignment
- workflow/hook safety hardening (path containment, timeout, output truncation, secret hygiene)

## Exit Criteria
- critical edge cases are fixed or explicitly accepted
- multi-host safety and fallback behavior are verified
- workflow-driven execution paths are hardened against unsafe/malformed workflow changes

## Delivered
- workflow workspace containment validation during reload and preflight
- fail-closed `after_create` / `before_run` hook execution for create and start paths
- best-effort `after_run` / `before_remove` lifecycle hooks for terminal and retry cleanup
- hook timeout enforcement plus sanitized/truncated stdout/stderr in operator-visible failures
- expanded host/federation regression coverage for auth, routing parity, reconciliation, and fallback paths

## Verification
- `npm test`
- `npm run phase8:verify`
