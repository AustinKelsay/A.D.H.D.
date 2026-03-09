# ADHD Dictation Intake Phase (Phase 14)

## Status
Planned.

## Objective
Add real dictation capture to the app so the product matches the voice-first intent already documented in the backend architecture.

## In Scope
- microphone capture UX
- transcript preview/edit flow
- provider abstraction for dictation input
- submission into existing `/api/intake` semantics
- fallback to typed input when dictation is unavailable

## Out of Scope
- ASR packaging/runtime distribution details
- advanced on-device model optimization

## Exit Criteria
- users can press-to-talk, review transcript text, and submit work from the app
- dictation and typed intake share the same downstream intent/job path
- dictation failure modes degrade cleanly to text-first operation

## Dependencies
- Phase 12 desktop client
- Phase 13 mobile client
