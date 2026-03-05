# ADHD Review and Hardening Phase (Phase 8)

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
