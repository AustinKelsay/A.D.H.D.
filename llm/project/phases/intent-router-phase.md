# ADHD Intent Router Phase

## Goals
- Turn incoming transcript/text into a codex-friendly task spec quickly and predictably through a provider-agnostic orchestrator layer.
- Make session creation deterministic from profile selection and user intent.

## Inputs
- `llm/project/user-flow.md`
- `llm/project/project-overview.md`
- `llm/project/project-rules.md`

## Scope
- In scope: normalization, provider-agnostic orchestration, intent fields, profile defaults, codex arg template mapping.
- Out of scope: mobile transport and full UI orchestration.

## Steps (per feature)
1. **Transcript contract**
   - Define normalized task object (`rawText`, `normalizedText`, `workType`, `target`, `constraints`, `profileHint`).
2. **Orchestrator provider contract**
   - Add a strict JSON input/output contract for an OpenAI-compatible planning endpoint.
   - Support configurable provider endpoints (`ollama`, `openrouter`, `maple.ai`, custom) behind a stable adapter.
3. **Routing rules**
   - Map task categories to execution profiles (`basic`, `edit`, `git`, `release`).
4. **Template mapping**
  - Create codex command templates (per profile) and apply deterministic defaults.
5. **Override handling**
- Accept explicit user profile and flag overrides at submit time.
5. **Resilience and preview**
  - Include provider identity, raw confidence score, required threshold by profile, and requires-confirmation state in the task plan object.
  - Populate a deterministic `planDecision` value (`autoRun` or `requiresConfirmation`) from confidence + profile policy.
  - Display the planned codex invocation before launch in non-destructive/optional high-risk mode.
  - Expose `requiresConfirmation` and `planDecision` in API responses so the client can request `/start` retry with explicit confirmation.
  - On planner/provider failure, return explicit failed-planning state and do not continue.

## Exit Criteria
- Same input text yields stable, inspectable task output.
- Wrong or unsupported task types fail fast with clear re-prompt text.
- Profile routing works consistently for common git/edit/test commands.
- Provider config missing/wrong route fails with explicit setup guidance.
