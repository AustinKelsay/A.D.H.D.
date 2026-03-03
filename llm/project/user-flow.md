# ADHD User Flow (V2)

## Purpose
Define the new end-to-end flow for dictation-driven Codex orchestration through app-server and MCP.

## Primary Actors
- Operator: person dictating tasks from desktop or phone
- ADHD service: accepts input, manages job lifecycle, stores history
- Codex conductor: top-level planning/delegation session
- Codex workers: delegated coding sessions/threads

## Primary Job States
- `draft`
- `queued`
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
2. ADHD normalizes input and creates a `queued` job.
3. ADHD submits the task into the conductor thread (`turn/start`).
4. Job enters `planning` while conductor interprets and structures execution.
5. If approvals/input are requested by Codex protocol events, job enters `awaiting_approval`.
6. ADHD forwards approval/input decisions back to Codex.
7. Conductor delegates work (`delegating`) using multi-agent roles or fallback worker threads.
8. Workers execute and stream events; job stays `running`.
9. Conductor synthesizes outcomes and final response (`summarizing`).
10. ADHD stores final summary, artifacts, and transitions to `completed`.

## Flow B: Interrupt / Cancel
1. User presses stop/cancel.
2. ADHD issues `turn/interrupt` (and worker interrupts if needed).
3. ADHD waits for terminal notifications and reconciles state.
4. Job becomes `cancelled` or `failed` with reason metadata.

## Flow C: Approval Gate
1. Codex emits approval-required event.
2. ADHD captures context (command/file/tool call + rationale) and surfaces it to UI.
3. User approves or rejects.
4. ADHD returns decision through protocol response.
5. Job resumes or terminates based on decision.

## Flow D: Restart Recovery
1. ADHD process restarts.
2. ADHD restores persisted job/session mapping.
3. ADHD reconnects to Codex app-server and refreshes thread/job status.
4. Stale in-flight jobs are reconciled into terminal or resumed states with explicit markers.

## UX Requirements
- Phone and desktop must show the same authoritative status.
- Every approval request must be actionable with one clear decision.
- Each completed job must include:
  - final summary
  - worker activity summary
  - timestamps and duration
  - links to logs/artifacts
