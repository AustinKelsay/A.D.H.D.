# ADHD MVP Phase

## Goals
- Deliver the first complete value loop: dictation/text input → codex launch → live tracking → completion summary.
- Provide practical host-trusted session controls from both desktop and phone.

## Scope
- In scope: multi-step queue, profile-aware launch, live session output.
- Out of scope: complex dependency graphs and advanced analytics.

## Steps
1. **Single input to first-run MVP**
   - Accept transcribed or typed task text.
   - Route through orchestrator agent to produce a validated plan before launch.
2. **Session runner + stream**
   - Launch `codex` as a child process per session using the orchestrator-approved invocation.
   - Stream output to session view and persist to run catalog.
3. **Session controls**
   - Add pause/stop/cancel/retry actions.
4. **Profile governance**
   - Implement `basic`, `edit`, `git`, `release` mode behavior and preflight confirmation for high-risk runs.
   - Expose confidence and provider metadata for decisions and auditability.
5. **Cross-client controls**
  - Ensure desktop and phone clients can both list sessions and control active runs.

## Verification coverage
- `bash scripts/adhd-304-controls-sweep.sh` (cancel and retry control flow from running/failed terminal sessions)
- `bash scripts/adhd-303-summary-sweep.sh` (summary persistence and output artifact checks for completed/failed terminal runs)

## Exit Criteria
- At least one session executes successfully end-to-end from phone and desktop.
- Session state transitions are visible and accurate.
- High-risk run confirmation is enforced where configured.
- Run catalog stores at least: task text, profile, status, output path, duration, exit code.
- Hard-fail planner/provider behavior is observable as a terminal planning error state with no fallback execution path.
