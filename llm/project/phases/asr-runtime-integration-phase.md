# ADHD ASR Runtime Integration Phase (Phase 15)

## Status
Planned.

## Objective
Integrate the speech-to-text runtime boundary needed for packaged dictation, with desktop and mobile using platform-appropriate approaches.

## In Scope
- desktop ASR runtime integration
- `Whispr`/CLI sidecar strategy for desktop packaging
- mobile-native dictation/ASR integration boundary
- runtime health and compatibility checks for ASR dependencies
- privacy/offline behavior decisions for dictation providers

## Out of Scope
- final app store/distribution workflow
- general desktop/mobile UX beyond dictation runtime integration

## Exit Criteria
- desktop dictation works through a packaged runtime boundary
- mobile dictation uses an explicit native/provider path rather than assuming desktop sidecar behavior
- the app can report whether dictation runtime prerequisites are healthy

## Dependencies
- Phase 14 dictation intake
- Tauri/mobile plugin boundary from earlier phases
