# ADHD Implementation Backlog

## Legend
- **Owner**: `you`, `agent`, or `shared`
- **Estimate**: rough engineering effort in hours
- **Depends on**: prerequisite tickets that must be done first
- **Acceptance tests**: strict Given/When/Then scenarios that define done

## Phase 0 — Setup

### ADHD-001: Initialize documentation and phase alignment
- **Owner:** you
- **Estimate:** 1
- **Depends on:** none
- **Acceptance tests (Given / When / Then):**
  - **Given** only raw repo files exist and no phase docs are present
  - **When** documentation scaffold is applied
  - **Then** all required planning docs exist under `llm/project/` and are internally cross-referenced
  - **Given** `phases/README.md` is created
  - **When** opening the file
  - **Then** it references every planned phase file
  - **Given** `llm/README.md` is updated
  - **When** a contributor reads it
  - **Then** it points to `llm/project/project-overview.md`, `llm/project/`, and `llm/workflows/` as source of truth

### ADHD-002: Define session + profile config schema
- **Owner:** agent
- **Estimate:** 1.5
- **Depends on:** ADHD-001
- **Acceptance tests (Given / When / Then):**
  - **Given** a new session object is created without `profile`
  - **When** schema validation runs
  - **Then** validation fails with `missing profile` and explicit field name
  - **Given** profile value is not one of `basic|edit|git|release`
  - **When** validation runs
  - **Then** the session is rejected with allowed-values error
  - **Given** a fully formed session is created
  - **When** persisted
  - **Then** required fields (`sessionId`, `profile`, `workingDirectory`, `state`, `createdAt`) are present and typed

### ADHD-003: Add host capability health checks
- **Owner:** agent
- **Estimate:** 2
- **Depends on:** ADHD-002
- **Acceptance tests (Given / When / Then):**
  - **Given** host PATH has no `codex` binary
  - **When** app starts
  - **Then** health check reports `missing tool: codex` and actionable remediation text
  - **Given** host PATH has `codex`/`git`/`gh` available
  - **When** checks run
  - **Then** all checks report ready and state is not blocked
  - **Given** a user opens diagnostics output
  - **When** check status is read
  - **Then** host mode and missing-tool recommendations are visible

### ADHD-004: Create startup diagnostics and bootstrap runbook
- **Owner:** agent
- **Estimate:** 1
- **Depends on:** ADHD-003
- **Acceptance tests (Given / When / Then):**
  - **Given** diagnostics command exists
  - **When** executed in a fresh environment
  - **Then** it prints a single status summary with each required tool status
  - **Given** a host is missing one required binary
  - **When** bootstrap command runs
  - **Then** output includes `install`/`PATH` remediation and suggests next command
  - **Given** host is in desktop-native mode
  - **When** diagnostics run
  - **Then** output includes native-mode detection and planning-provider hard-fail status

### ADHD-005: Add orchestrator provider configuration checks
- **Owner:** agent
- **Estimate:** 1.5
- **Depends on:** ADHD-004
- **Acceptance tests (Given / When / Then):**
  - **Given** `ADHD_ORCHESTRATOR_PROVIDER` is set to `ollama`
  - **When** health checks run
  - **Then** they validate OpenAI-compatible `/v1/chat/completions` path responsiveness
  - **Given** provider is set to hosted mode without key
  - **When** checks run
  - **Then** readiness is blocked with actionable auth configuration guidance
  - **Given** provider is invalid
  - **When** startup check runs
  - **Then** diagnostics include exact endpoint, payload expectations, and recovery steps

## Phase 1 — Session Runtime

### ADHD-101: Implement canonical session state model
- **Owner:** agent
- **Estimate:** 3
- **Depends on:** ADHD-002, ADHD-003
- **Acceptance tests (Given / When / Then):**
  - **Given** a session starts in `queued`
  - **When** start request is sent
  - **Then** transitions are only `queued -> awaiting_confirmation -> starting -> running` with confirmation gating.
  - **Given** an invalid transition is requested (e.g., `completed -> running`)
  - **When** transition is applied
  - **Then** runtime rejects it with a typed transition error
  - **Given** a completed session attempts to transition
  - **When** any nonterminal transition is applied
  - **Then** transition is rejected and state remains `completed`

### ADHD-102: Build runner lifecycle manager
- **Owner:** agent
- **Estimate:** 4
- **Depends on:** ADHD-101
- **Acceptance tests (Given / When / Then):**
  - **Given** a valid session with mapped codex command
  - **When** runner starts
  - **Then** process launches, emits output chunks, and ends with status code
  - **Given** a running session is cancelled
  - **When** cancellation is invoked
  - **Then** process stops and session enters `cancelled`
  - **Given** temporary artifact files are created
  - **When** process completes or cancels
  - **Then** artifact pointers are updated and no orphan lock files remain

### ADHD-103: Add concurrency and queue policy
- **Owner:** agent
- **Estimate:** 2.5
- **Depends on:** ADHD-102
- **Acceptance tests (Given / When / Then):**
  - **Given** max concurrency is `1`
  - **When** two sessions are launched
  - **Then** one session runs and one remains `queued`
  - **Given** queued session exists and running session completes
  - **When** queue reconciliation executes
  - **Then** next queued session starts automatically
  - **Given** over-limit request is submitted while queue is full
  - **When** strategy is configured as deterministic
  - **Then** submission outcome is either `queued` or immediate rejection based on configured policy

### ADHD-104: Persist run output and session lifecycle snapshots
- **Owner:** agent
- **Estimate:** 2
- **Depends on:** ADHD-102
- **Acceptance tests (Given / When / Then):**
  - **Given** a session writes output
  - **When** session finishes
  - **Then** output path and lifecycle snapshot are persisted
  - **Given** an app restart occurs after session completion
  - **When** app loads persisted records
  - **Then** run output is accessible from catalog/snapshot
  - **Given** failed session with stderr output
  - **When** persisted snapshot is opened
  - **Then** both stdout and stderr locations are present

### ADHD-105: Implement failure handling for terminal states
- **Owner:** agent
- **Estimate:** 2
- **Depends on:** ADHD-102, ADHD-104
- **Acceptance tests (Given / When / Then):**
  - **Given** codex startup fails due to invalid command
  - **When** runner starts
  - **Then** state transitions to `failed` with categorized error
  - **Given** session timeout elapses before completion
  - **When** timeout trigger fires
  - **Then** session transitions to `failed` or `cancelled` per config and cleanup runs
  - **Given** transient spawn failure occurs
  - **When** retry policy is enabled
  - **Then** at least one retry is attempted and state remains non-stale

## Phase 2 — Intent Router

### ADHD-201: Define normalized task contract
- **Owner:** you
- **Estimate:** 1.5
- **Depends on:** ADHD-101
- **Acceptance tests (Given / When / Then):**
  - **Given** transcript input includes extra punctuation
  - **When** it is normalized
  - **Then** output contains `rawText` and deterministic `normalizedText`
  - **Given** input has ambiguous target path
  - **When** parser runs
  - **Then** `target` defaults to configured workspace and records ambiguity constraints
  - **Given** task includes explicit constraints
  - **When** contract validator runs
  - **Then** `constraints` are preserved in normalized object

### ADHD-202: Implement worktype-to-profile routing
- **Owner:** agent
- **Estimate:** 2
- **Depends on:** ADHD-201
- **Acceptance tests (Given / When / Then):**
  - **Given** worktype resolves to known classification (e.g., `refactor`)
  - **When** routing runs
  - **Then** mapped profile is `edit`
  - **Given** worktype is `push` or `open pr`
  - **When** routing runs
  - **Then** mapped profile is `git`
  - **Given** unknown worktype appears
  - **When** router executes
  - **Then** session returns safe-fail with profile suggestion list

### ADHD-203: Codex invocation template system
- **Owner:** agent
- **Estimate:** 3
- **Depends on:** ADHD-202
- **Acceptance tests (Given / When / Then):**
  - **Given** session profile is `git`
  - **When** command template resolves
  - **Then** generated command includes deterministic profile overrides and working directory
  - **Given** profile is `release`
  - **When** risky flags are needed
  - **Then** command includes required guard markers for confirmation path
  - **Given** profile template changes
  - **When** app restarts
  - **Then** same profile yields stable command shape unless schema version changes

### ADHD-204: Add launch preview for risky sessions
- **Owner:** you
- **Estimate:** 1.5
- **Depends on:** ADHD-203
- **Acceptance tests (Given / When / Then):**
  - **Given** session is marked `release` or explicit high-risk
  - **When** user submits task
  - **Then** preview displays command, working directory, and risk summary before execution
  - **Given** user cancels from preview
  - **When** they confirm cancel
  - **Then** no runner process is launched
  - **Given** user confirms from preview
  - **When** confirmation is accepted
  - **Then** session moves to `starting` with traceable `sessionId`

### ADHD-205: Build provider-agnostic orchestrator adapter
- **Owner:** agent
- **Estimate:** 3
- **Depends on:** ADHD-203, ADHD-005
- **Acceptance tests (Given / When / Then):**
  - **Given** `ADHD_ORCHESTRATOR_PROVIDER=ollama`
  - **When** planning is requested
  - **Then** it uses local base URL and default local model with timeout handling
  - **Given** provider changes to `openrouter`
  - **When** planning is requested
  - **Then** adapter uses configured base URL, model, and auth headers
  - **Given** provider returns malformed JSON
  - **When** validation runs
  - **Then** session enters failed planning state with user-visible error and remediation

### ADHD-206: Enforce planner confidence gating
- **Owner:** agent
- **Estimate:** 1.5
- **Depends on:** ADHD-205
- **Acceptance tests (Given / When / Then):**
  - **Given** profile is `basic`
  - **When** confidence >= 0.88
  - **Then** session can auto-run
  - **Given** profile is `git`
  - **When** confidence = 0.92
  - **Then** session requires explicit confirmation
  - **Given** profile is `release`
  - **When** confidence is high and all fields are valid
  - **Then** session still requires explicit confirmation
  - **Given** confidence is missing
  - **When** planning completes
  - **Then** session enters blocked-planning-failed state and surfaces remediation

## Phase 3 — MVP

### ADHD-301: Build session submit flow from transcript/text input
- **Owner:** agent
- **Estimate:** 3
- **Depends on:** ADHD-201, ADHD-203
- **Acceptance tests (Given / When / Then):**
  - **Given** desktop dictation returns a transcript
  - **When** submit is triggered
  - **Then** a session is created with normalized task and chosen profile
  - **Given** phone enters typed task text
  - **When** submit is triggered
  - **Then** a session is created with same schema as desktop
  - **Given** no active profile selected
  - **When** submit is triggered
  - **Then** flow fails with profile required error and no runner launch

### ADHD-302: Live status/event rendering in desktop UI
- **Owner:** agent
- **Estimate:** 2.5
- **Depends on:** ADHD-102, ADHD-301
- **Acceptance tests (Given / When / Then):**
  - **Given** a session transitions from `queued` to `running`
  - **When** state changes are emitted
  - **Then** UI updates within 1 second
  - **Given** output stream emits multiple lines
  - **When** user monitors session list
  - **Then** lines append without blocking controls
  - **Given** session enters `failed`
  - **When** terminal state is emitted
  - **Then** summary panel shows exit code and last error

### ADHD-303: Add run summary persistence
- **Owner:** agent
- **Estimate:** 2
- **Depends on:** ADHD-104, ADHD-302
- **Acceptance tests (Given / When / Then):**
  - **Given** session completes successfully
  - **When** persistence completes
  - **Then** summary records duration, exit code, output path, and transcript
  - **Given** session fails
  - **When** persistence completes
  - **Then** summary marks failure and stores error category
  - **Given** UI opens completed session detail
  - **When** data is loaded
  - **Then** summary fields are non-null and match runtime metadata

### ADHD-304: Add basic session controls
- **Owner:** agent
- **Estimate:** 1.5
- **Depends on:** ADHD-302
- **Acceptance tests (Given / When / Then):**
  - **Given** a running session
  - **When** user clicks `cancel`
  - **Then** runner stops and state becomes `cancelled`
  - **Given** a failed session
  - **When** user clicks `retry`
  - **Then** a new session is created with identical task context
  - **Given** a completed session
  - **When** user opens details
  - **Then** details render same lifecycle timeline and output links

## Phase 4 — Mobile Control and Auth

### ADHD-401: Define pairing/auth handshake API
- **Owner:** you
- **Estimate:** 2
- **Depends on:** ADHD-101, ADHD-301
- **Acceptance tests (Given / When / Then):**
  - **Given** no active pairing token
  - **When** a phone tries API access
  - **Then** request is rejected with auth failure
  - **Given** user generates short-lived token
  - **When** token is used by phone before expiry
  - **Then** API calls succeed for allowed endpoints
  - **Given** token expiry time passes
  - **When** old token is used
  - **Then** request is denied and new token required

### ADHD-402: Add mobile session API and transport
- **Owner:** agent
- **Estimate:** 3
- **Depends on:** ADHD-401
- **Acceptance tests (Given / When / Then):**
  - **Given** an active session exists
  - **When** phone requests session list
  - **Then** response includes all sessions with state and progress
  - **Given** phone sends `start/cancel/retry`
  - **When** request is valid
  - **Then** action is applied and reflected in state updates
  - **Given** network hiccup happens
  - **When** phone reconnects
  - **Then** latest session state is returned and no duplicate actions are applied

### ADHD-403: Build responsive mobile session views
- **Owner:** agent
- **Estimate:** 2.5
- **Depends on:** ADHD-402
- **Acceptance tests (Given / When / Then):**
  - **Given** active sessions are listed
  - **When** rendered on small viewport
  - **Then** active session card and controls remain visible without horizontal scroll
  - **Given** user taps `cancel` on mobile
  - **When** action is confirmed
  - **Then** session state updates immediately and control is disabled
  - **Given** completed session exists
  - **When** opening detail
  - **Then** output and summary are reachable within one navigation level

### ADHD-404: Normalize cross-device action semantics
- **Owner:** shared
- **Estimate:** 1.5
- **Depends on:** ADHD-402, ADHD-403
- **Acceptance tests (Given / When / Then):**
  - **Given** desktop calls `cancel` for a session
  - **When** phone performs same action on same `sessionId`
  - **Then** both endpoints return equivalent result and state transition
  - **Given** API supports action by `sessionId`
  - **When** called from either client
  - **Then** payload shape and response structure are identical
  - **Given** a race between clients occurs
  - **When** both send `retry` simultaneously
  - **Then** idempotent behavior is enforced and one canonical retried session is created

## Phase 5 — Catalog and Observability

### ADHD-501: Build searchable run catalog
- **Owner:** agent
- **Estimate:** 3
- **Depends on:** ADHD-104, ADHD-303
- **Acceptance tests (Given / When / Then):**
  - **Given** at least 10 sessions exist
  - **When** filter by `profile=git`
  - **Then** only git-profile sessions are shown
  - **Given** filter date range is set to last 24h
  - **When** query executes
  - **Then** results exclude older sessions
  - **Given** user changes sort to oldest-to-newest
  - **When** catalog renders
  - **Then** ordering matches timestamp asc and is stable

### ADHD-502: Add output log indexing and deep links
- **Owner:** agent
- **Estimate:** 2
- **Depends on:** ADHD-501
- **Acceptance tests (Given / When / Then):**
  - **Given** completed session has output files
  - **When** catalog row is opened
  - **Then** links resolve to full output and error log files
  - **Given** session has no stderr
  - **When** indexer runs
  - **Then** stderr link is hidden or marked `not available`
  - **Given** app restarts after log generation
  - **When** user opens catalog
  - **Then** log links still resolve without stale paths

### ADHD-503: Add retention policy controls
- **Owner:** you
- **Estimate:** 1.5
- **Depends on:** ADHD-501
- **Acceptance tests (Given / When / Then):**
  - **Given** retention age is set to 7 days
  - **When** scheduled cleanup runs
  - **Then** sessions older than 7 days are archived or removed per policy
  - **Given** retention count is set to 100
  - **When** count exceeds limit
  - **Then** oldest entries are removed deterministically
  - **Given** cleanup executes
  - **When** action completes
  - **Then** catalog logs show how many sessions were pruned

### ADHD-504: Implement replay/clone run actions
- **Owner:** agent
- **Estimate:** 2
- **Depends on:** ADHD-501, ADHD-502
- **Acceptance tests (Given / When / Then):**
  - **Given** failed session exists in catalog
  - **When** user taps `rerun`
  - **Then** new session inherits task context and profile
  - **Given** user changes profile during clone
  - **When** rerun is confirmed
  - **Then** updated profile overrides inherited context
  - **Given** rerun starts
  - **When** it completes
  - **Then** both original and rerun outcomes are independently stored

### ADHD-505: Introduce error taxonomy and structured diagnostics
- **Owner:** agent
- **Estimate:** 2
- **Depends on:** ADHD-105
- **Acceptance tests (Given / When / Then):**
  - **Given** a missing-tool error occurs
  - **When** it is emitted
  - **Then** category is `missing-tool` and recovery guidance is present
  - **Given** invalid profile is used
  - **When** session fails early
  - **Then** category is `invalid-profile` with corrective action
  - **Given** transport loss occurs
  - **When** diagnostics update
  - **Then** category is `transport-loss` and reconnect guidance is shown

## Phase 6 — Review, Reliability, and Release

### ADHD-601: Session recovery and stale-state reconciliation
- **Owner:** agent
- **Estimate:** 2.5
- **Depends on:** ADHD-104, ADHD-105, ADHD-505
- **Acceptance tests (Given / When / Then):**
  - **Given** app crashes while session is `running`
  - **When** user restarts app
  - **Then** session is marked `failed` or `orphaned` with reconciliation notes
  - **Given** stale snapshot exists
  - **When** startup reconciliation runs
  - **Then** stale entry is either resumed if recoverable or safely closed
  - **Given** unexpected exit leaves artifacts
  - **When** cleanup reconciliation runs
  - **Then** no running process remains and metadata is consistent

### ADHD-602: Run hardening test sweep
- **Owner:** you
- **Estimate:** 2
- **Depends on:** ADHD-601
- **Acceptance tests (Given / When / Then):**
  - **Given** all core scenarios are prepared in script/test matrix
  - **When** runbook is executed
  - **Then** cancellation during startup is logged as safe terminal transition
  - **Given** host tool disappears mid-session
  - **When** failure is triggered
  - **Then** hardening test verifies recovery guidance is displayed
  - **Given** reconnect test script runs
  - **When** state re-sync occurs
  - **Then** UI eventually shows canonical session states

### ADHD-603: Add release and distribution checklist
- **Owner:** shared
- **Estimate:** 1.5
- **Depends on:** ADHD-602
- **Acceptance tests (Given / When / Then):**
  - **Given** a fresh machine follows checklist
  - **When** onboarding starts
  - **Then** each release prerequisite is checked and either passes or blocks clearly
  - **Given** migration/rollback instructions are needed
  - **When** release version changes schema
  - **Then** checklist includes migration command and rollback command
  - **Given** release build runs
  - **When** smoke check is executed
  - **Then** the runbook demonstrates one session from creation to completion

### ADHD-604: Publish and lock profile behavior
- **Owner:** you
- **Estimate:** 1
- **Depends on:** ADHD-603
- **Acceptance tests (Given / When / Then):**
  - **Given** default profile matrix is finalized
  - **When** launch page/docs are reviewed
  - **Then** behavior is explicit for each profile
  - **Given** user starts `release` session
  - **When** confirmation expectation is configured
  - **Then** session does not start without confirmation
  - **Given** profile behavior changes in PR
  - **When** ticket closes
  - **Then** doc and runtime default are updated in the same change

## Optional cross-cutting ticket (recommended first week)

### ADHD-901: Add `llm/workflows/dev-env-local.md` in active repo style
- **Owner:** agent
- **Estimate:** 1
- **Depends on:** ADHD-601
- **Acceptance tests (Given / When / Then):**
  - **Given** workflow file exists
  - **When** a new contributor follows it
  - **Then** they can boot health checks and run one verified task
  - **Given** workflow is updated
  - **When** lint or verification runs
  - **Then** checklist links and commands remain valid
  - **Given** docs review step runs
  - **When** workflow is changed
  - **Then** runbook includes prerequisite, setup, and troubleshooting sections
