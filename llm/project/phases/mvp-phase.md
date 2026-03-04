# ADHD MVP Phase (Phase 3)

## Objective
Ship the first complete value loop on a single host baseline.

## In Scope
- dictation/text intake
- live execution state
- approval/interrupt/retry controls
- completion summary and artifacts

## Exit Criteria
- end-to-end task completes reliably on one host
- desktop and phone show consistent state
- summaries and artifacts are persisted

## Current Baseline Artifacts
- `src/server/host-api.js`
- `src/runtime/host-runtime.js`
- `src/runtime/session-store.js`
- `src/runtime/state-machine.js`
- `config/schemas/job.schema.json`
- `test/host-api.test.js`
- `test/host-runtime.test.js`
- `test/session-store.test.js`

## API Surface (Phase 3 Additions)
- `POST /api/intake` (voice/text unified intake, optional `autoStart`)
- `POST /api/jobs/:jobId/retry` (optional `startNow`)
- `GET /api/jobs/:jobId/live` (job + pending approvals for polling clients)
- `GET /api/jobs/:jobId/result` (summary + artifact paths)

## Intake Payload (Phase 3)
- Text:
  - `inputText: "..."` (backward-compatible)
  - or `intake: { mode: "text", text: "...", source?: "..." }`
- Voice:
  - `intake: { mode: "voice", transcript: "...", source?: "...", language?: "...", segments?: [...] }`

## Verification Commands
- `npm test`
- `npm run phase3:verify`
