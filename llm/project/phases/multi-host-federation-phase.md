# ADHD Multi-Host Federation Phase (Phase 5)

## Objective
Enable one ADHD control plane to orchestrate multiple host machines.

## In Scope
- host enrollment and revocation
- host heartbeat/capability sync
- per-job host targeting and host-aware dispatch
- host outage handling and recovery behavior

## Work Items
1. Host registry
- Add `hostId`, host metadata, auth status, compatibility status.

2. Secure enrollment
- Add signed token/certificate-based enrollment and revocation flow.

3. Host routing
- Manual host selection first; optional auto-routing policy later.

4. Host-aware controls
- Route interrupt/retry/approve actions to correct host.

5. Outage policy
- Define and implement behavior for offline hosts and stranded jobs.

## Exit Criteria
- same app can operate Host A and Host B
- each job is clearly bound to one host
- outage handling is deterministic and test-covered
