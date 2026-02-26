# ADHD User Flow

## Purpose
Define how users move through ADHD from speech or text input to managed codex execution and result review.

## Audience and Personas
- **Solo operator:** one machine owner orchestrating coding tasks via dictation.
- **Mobile operator:** controls the same orchestrator from phone while away from keyboard.
- **Desktop operator:** uses the same controls from the local desktop app.

## Primary States
- `idle`: No active task; capture and session controls available.
- `capturing`: Dictation capture in progress.
- `processing`: Transcript is parsed into a task intent.
- `planning`: Orchestrator agent resolves intent into execution spec.
- `queued`: Task is waiting for a codex slot.
- `running`: One or more codex sessions active.
- `completed`: Session finished successfully.
- `failed`: Session ended with error.
- `cancelled`: Session stopped by user.

## End-to-End Flows

### 1) Desktop native flow
1. User clicks mic or uses hotkey.
2. Frontend routes to native dictation runtime (or fallback where unavailable).
3. Transcript appears with confidence metadata.
4. User picks or confirms profile (`basic`, `edit`, `git`, `release`).
5. Session enters `planning` while orchestrator agent requests a codex invocation plan from an OpenAI-compatible provider.
6. ADHD validates the plan against profile constraints and confidence thresholds, then auto-runs or waits for user confirmation.
7. To execute a plan requiring confirmation, the client retries `POST /api/sessions/:id/start` with `{"confirm":true}`.
8. Session appears in the session list with live log stream.
9. User monitors or adjusts, then archives/reads completion summary.

### 2) Phone flow
1. Phone connects to orchestrator through paired session channel.
2. Submit text or use phone dictation if available.
3. Set mode profile and start the run.
4. Wait through planning and queue/running states.
5. View the live status stream and pause/cancel/retry as needed.
6. Open session detail from any screen.

### 3) Multi-session orchestration flow
1. Submit multiple tasks with distinct profiles.
2. Orchestrator enqueues up to configured parallel limit.
3. Sessions transition independently through lifecycle states.
4. Cancel or reprioritize a session manually.
5. Completed sessions remain in run catalog with logs and exit metadata.

### 4) Git/GitHub operational flow
1. Submit a git-oriented task (e.g., `run tests`, `create branch`, `open PR`).
2. Select the `git` profile.
3. Orchestrator agent adds a plan summary and confidence signal using configured provider.
4. Codex runs on host machine using existing auth/tooling.
5. Log output and command effects are displayed and recorded.
6. Optional confirmation may gate push/merge style actions.

## Decision Points
- Profile selection is explicit per session.
- Destructive actions can require optional preflight confirmation.
- Host availability gating: if codex not found, queueing is blocked with remediation text.
- Planning provider availability: endpoint or planning errors are hard-fail with explicit remediation; no execution fallback is attempted.
- Planning confidence gating:
  - `release` always requires explicit confirmation.
  - `git` requires higher confidence than `basic`/`edit`.
  - Missing confidence requires hard-fail with retry/review action.

## Error Flows
- Host disconnected: session controls disabled; resume when host reconnects.
- Profile mismatch: session fails before launch with actionable correction hints.
- Permission issue from host tooling: surface raw command output plus next-step suggestions.
- Orchestrator endpoint error: surface provider name, status code, and retry suggestion; keep queued session visible with error context.

## Exit Criteria by Flow
- One session can be started and completed from either desktop or phone.
- Session status and logs remain visible across both clients.
- A user can cancel and rerun a failed session in one click/tap.
