# ADHD User Flow (V2 Federated)

## Purpose
Define end-to-end behavior for dictation-driven Codex orchestration across multiple host machines.

## Primary Actors
- Operator (desktop/phone)
- ADHD control plane
- ADHD host node (target machine)
- Codex conductor and workers on that host

## Primary Job States
- `draft`
- `queued`
- `dispatching`
- `planning`
- `awaiting_approval`
- `delegating`
- `running`
- `summarizing`
- `completed`
- `failed`
- `cancelled`

## Flow A: Voice To Completed Result
1. User dictates or types a task.
2. Control plane normalizes input and creates a queued job.
3. User selects target host (manual default) or routing policy assigns one.
4. Job enters `dispatching` and is sent to that host node.
5. Host conductor runs planning/delegation/execution locally.
6. Approval requests and progress stream back through control plane.
7. Control plane persists timeline and returns final summary/artifacts.

## Flow B: Interrupt / Cancel
1. User interrupts a running job from desktop or phone.
2. Control plane routes interrupt to target host.
3. Host issues `turn/interrupt` and worker stops as needed.
4. Terminal state and reason sync back to control plane.

## Flow C: Approval Gate
1. Host emits approval-required event.
2. Control plane surfaces approval payload to user.
3. User approves/rejects.
4. Decision is relayed to host and execution continues or terminates.

## Flow D: Host Offline Handling
1. Host heartbeat fails.
2. Host marked degraded/offline in control plane.
3. New jobs are blocked from that host.
4. In-flight jobs are marked `failed` or `awaiting_host_recovery` per policy.

## UX Requirements
- Host picker and host health are visible before run.
- All live and historical jobs display host identity.
- Desktop and phone show the same authoritative cross-host state.
