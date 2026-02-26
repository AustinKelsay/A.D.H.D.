import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  normalizeText,
  buildOrchestratorEndpoint,
  buildOrchestratorHeaders,
  resolveOrchestratorConfig,
} from './lib/orchestrator-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_OUTPUT_CHARS = 16000;
const MAX_BODY_SIZE = parsePositiveInt(process.env.ADHD_MAX_BODY_SIZE_BYTES, 1024 * 1024);
const DEFAULT_TIMEOUT_MS = parsePositiveInt(process.env.ADHD_SESSION_TIMEOUT_MS, 120000);
const ORCHESTRATOR_TIMEOUT_MS = parsePositiveInt(process.env.ADHD_ORCHESTRATOR_TIMEOUT_MS, 15000);
const MAX_CONCURRENT_SESSIONS = parsePositiveInt(process.env.ADHD_MAX_CONCURRENT_SESSIONS, 1);
const START_QUEUE_POLICY = parseStartQueuePolicy(process.env.ADHD_START_QUEUE_POLICY || 'queue');
const QUEUE_FULL_ERROR_CODE = 'RUNNER_QUEUE_FULL';
const SESSION_PERSIST_PATH = process.env.ADHD_SESSION_PERSIST_PATH || path.join(__dirname, 'data', 'sessions.json');
const SESSION_PERSIST_WRITE_DELAY_MS = parsePositiveInt(
  process.env.ADHD_SESSION_PERSIST_WRITE_DELAY_MS || 250,
  250,
);
const RUNNER_TIMEOUT_TERMINAL_STATE = parseTimeoutTerminalState(
  process.env.ADHD_RUNNER_TIMEOUT_TERMINAL_STATE || 'failed',
);
const RUNNER_RETRY_ENABLED = parseBoolean(process.env.ADHD_RUNNER_RETRY_ENABLED || false);
const RUNNER_MAX_RETRIES = parseRetryLimit(
  process.env.ADHD_RUNNER_MAX_RETRIES,
  1,
);
const RUNNER_RETRY_DELAY_MS = parseRetryLimit(
  process.env.ADHD_RUNNER_RETRY_DELAY_MS || 200,
  200,
);
const API_TOKEN = process.env.ADHD_API_TOKEN || '';
const API_PAIRING_TTL_MS = parsePositiveInt(process.env.ADHD_PAIR_TOKEN_TTL_MS || 600000, 600000);
const ADHD_SESSION_RETENTION_DAYS = parseNonNegativeInt(process.env.ADHD_SESSION_RETENTION_DAYS || 0, 0);
const ADHD_SESSION_RETENTION_MAX_COUNT = parseNonNegativeInt(process.env.ADHD_SESSION_RETENTION_MAX_COUNT || 0, 0);
const MOBILE_ACTION_IDEMPOTENCY_TTL_MS = parsePositiveInt(
  process.env.ADHD_MOBILE_ACTION_IDEMPOTENCY_MS || 30000,
  30000,
);
const API_AUTH_HEADER = 'x-adhd-api-token';
const MOBILE_ACTION_ID_HEADER = 'x-adhd-action-id';
const LOCAL_API_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);
const DEFAULT_STATE = 'queued';
const SESSION_PROFILES = new Set(['basic', 'edit', 'git', 'release']);
const SESSION_STATES = new Set([
  'queued',
  'awaiting_confirmation',
  'starting',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
const TERMINAL_SESSION_STATES = new Set(['completed', 'failed', 'cancelled']);
const ORCHESTRATOR_PLAN_DECISION = {
  autoRun: 'autoRun',
  requiresConfirmation: 'requiresConfirmation',
};
const ORCHESTRATOR_PLAN_ENDPOINT_PATH = '/chat/completions';
const ORCHESTRATOR_PLANNING_BLOCKED_ERROR_CODE = 'blocked-planning-failed';
const SESSION_OUTPUT_DIR = path.join(path.dirname(SESSION_PERSIST_PATH), 'outputs');
const SESSION_OUTPUT_DIR_RESOLVED = path.resolve(SESSION_OUTPUT_DIR);
const ORCHESTRATOR_PLAN_THRESHOLD = {
  basic: 0.88,
  edit: 0.88,
  git: 0.93,
  release: 1,
};
const SESSION_TRANSITIONS = {
  queued: new Set(['starting', 'awaiting_confirmation', 'failed', 'cancelled']),
  awaiting_confirmation: new Set(['starting', 'failed', 'cancelled']),
  starting: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};
const SESSION_EVENTS_KEEPALIVE_MS = parsePositiveInt(process.env.ADHD_SESSION_EVENTS_KEEPALIVE_MS || 15000, 15000);
const SESSION_EVENT_CLIENTS = new Set();
const MOBILE_SESSION_EVENT_CLIENTS = new Set();
const MOBILE_ACTION_CACHE = new Map();
const SESSION_RETRY_ACTION_CACHE = new Map();
const SESSION_RERUN_ACTION_CACHE = new Map();
const ACTIVE_PAIR_TOKENS = new Map();
const RETRY_SESSION_ACTION_TTL_MS = parsePositiveInt(
  process.env.ADHD_RETRY_ACTION_IDEMPOTENCY_MS || MOBILE_ACTION_IDEMPOTENCY_TTL_MS,
  MOBILE_ACTION_IDEMPOTENCY_TTL_MS,
);
const ERROR_GUIDANCE_BY_CATEGORY = {
  'missing-tool': 'Install the runtime command from PATH or configure a valid ADHD_CODEX_*_COMMAND value.',
  'invalid-profile': `Use one of: ${[...SESSION_PROFILES].sort().join(', ')}, or change task intent routing.`,
  'transport-loss': 'Connection to the planning/runtime transport failed. Retry the action and, if persistent, check network/orchestrator availability and reconnect.',
  'orchestrator-unavailable': 'Check orchestrator configuration and connectivity (provider, endpoint, credentials).',
  'orchestrator-invalid-plan': 'The orchestrator returned an invalid plan. Retry; if repeated, review orchestrator model output schema.',
  'runner-spawn': 'Retry execution or switch to a valid local command/tool available in this runtime.',
  'runner-process-error': 'The process emitted an error; inspect output/artifacts and retry.',
  'runner-exit-signal': 'Process terminated by signal. Retry if appropriate or switch runtime command.',
  'runner-exit-nonzero': 'Process exited unsuccessfully; inspect output/artifacts and retry after fixing command inputs.',
  'runner-timeout-failed': 'Execution exceeded timeout. Increase ADHD_SESSION_TIMEOUT_MS or retry with a smaller workload.',
  'runner-timeout-cancelled': 'Execution was cancelled due timeout policy. Retry if still needed.',
  'server-restart': 'Session was active during a server restart and has been reconciled to a safe terminal state.',
  'planner-failed': 'Planner failed; retry, and confirm orchestrator readiness.',
  'invalid-state': 'Retry from a terminal state (completed/failed/cancelled) only.',
  'unknown': 'Retry the action and review previous output for clues.',
};

const PROFILE_WORKTYPE_RULES = [
  {
    profile: 'git',
    terms: ['push', 'pull request', 'open pr', 'pr', 'commit', 'merge', 'branch', 'checkout', 'cherry-pick', 'rebase', 'status'],
  },
  {
    profile: 'release',
    terms: ['release', 'publish', 'deploy', 'ship', 'tag'],
  },
  {
    profile: 'edit',
    terms: ['refactor', 'edit', 'update', 'remove', 'delete', 'create', 'modify', 'fix', 'rename', 'implement'],
  },
];

const PROFILE_SUGGESTIONS = [...SESSION_PROFILES].sort();

function parseBoolean(value) {
  return normalizeBoolean(value);
}

function splitArgs(value) {
  return normalizeText(value || '')
    .split(/\s+/)
    .filter(Boolean);
}

function makeProfileRuntimeTemplate(profile) {
  const profileKey = String(profile || '').toUpperCase();
  const command = normalizeText(
    process.env[`ADHD_CODEX_${profileKey}_COMMAND`] || process.env.ADHD_CODEX_COMMAND || 'codex',
  );
  const baseArgs = splitArgs(
    process.env[`ADHD_CODEX_${profileKey}_ARGS`] ||
      process.env.ADHD_CODEX_ARGS ||
      process.env.ADHD_CODEX_HELP_ARGS ||
      '--help',
  );
  const profileGuardArgs = splitArgs(process.env[`ADHD_CODEX_${profileKey}_GUARD_ARGS`]);
  const extraArgs = profile === 'release'
    ? [...profileGuardArgs, '--requires-confirmation', '--high-risk-review-mode']
    : profileGuardArgs;
  const taskArgToken = normalizeText(
    process.env[`ADHD_CODEX_${profileKey}_TASK_ARG`] ||
      process.env.ADHD_CODEX_TASK_ARG ||
      '',
  );

  return {
    command,
    args: [...baseArgs, ...extraArgs],
    taskArgToken,
  };
}

const PROFILE_RUNTIME_TEMPLATES = {
  basic: makeProfileRuntimeTemplate('basic'),
  edit: makeProfileRuntimeTemplate('edit'),
  git: makeProfileRuntimeTemplate('git'),
  release: makeProfileRuntimeTemplate('release'),
};

const CODEX_TASK_PLACEHOLDER = '{{task}}';

function resolveProfileTemplate(profile) {
  const profileKey = normalizeProfile(profile) || normalizeProfile(runtimeDefaults.profile);
  const template = PROFILE_RUNTIME_TEMPLATES[profileKey];
  if (!template) return null;

  return {
    command: normalizeText(template.command || ''),
    args: Array.isArray(template.args) ? template.args.slice() : [],
    taskArgToken: normalizeText(template.taskArgToken || ''),
  };
}

const sessionCatalog = new Map();
let sessionPersistTimer = null;

function buildSessionOutputPath(sessionId) {
  const safeSessionId = normalizeText(sessionId || '');
  return path.join(SESSION_OUTPUT_DIR, `${safeSessionId || makeSessionId()}-run-output.txt`);
}

function buildSessionOutputStreamPaths(sessionId, outputPath) {
  const absoluteOutputPath = path.resolve(normalizeText(outputPath) || buildSessionOutputPath(sessionId));
  const parsed = path.parse(absoluteOutputPath);
  const baseName = parsed.ext
    ? path.join(parsed.dir, parsed.name)
    : absoluteOutputPath;

  return {
    combined: absoluteOutputPath,
    stdout: `${baseName}.stdout.txt`,
    stderr: `${baseName}.stderr.txt`,
  };
}

function resolveSessionOutputPath(session = {}) {
  const outputPath = normalizeText(session?.summary?.outputPath || '');
  if (!outputPath) return null;

  const resolvedPath = path.resolve(outputPath);
  const relativePath = path.relative(SESSION_OUTPUT_DIR_RESOLVED, resolvedPath);
  if (
    !relativePath
    || relativePath.startsWith('..')
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return resolvedPath;
}

function buildSessionTranscript(session) {
  const stdout = normalizeText(session.runtime?.output?.stdout || '');
  const stderr = normalizeText(session.runtime?.output?.stderr || '');
  if (!stdout && !stderr) return '';
  if (!stdout) return stderr;
  if (!stderr) return stdout;
  return `${stdout}\n${stderr}`;
}

function persistOutputArtifact(outputPath, text) {
  const payload = normalizeText(text);
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, payload, 'utf8');
  } catch {
    // optional output artifact persistence is non-blocking
  }
}

function hasTerminalSummary(session, summary = {}) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
  if (!Number.isFinite(Number(summary.durationMs)) || summary.durationMs < 0) return false;
  if (!(summary.exitCode === null || Number.isFinite(Number(summary.exitCode)))) return false;
  if (!normalizeText(summary.outputPath)) return false;
  if (typeof summary.transcript !== 'string') return false;
  if (typeof summary.failed !== 'boolean') return false;
  if (!Object.prototype.hasOwnProperty.call(summary, 'errorCategory')) return false;
  if (!Object.prototype.hasOwnProperty.call(summary, 'failureReason')) return false;
  return summary.failed === (session.state === 'failed');
}

function ensureTerminalSummary(session, context = {}) {
  if (!session || typeof session !== 'object') return;
  if (!TERMINAL_SESSION_STATES.has(session.state)) return;
  if (hasTerminalSummary(session, session.summary)) return;

  const errorCategory = context.errorCategory !== undefined
    ? context.errorCategory
    : normalizeText(session.summary?.errorCategory || session.orchestrator?.category || '');
  const failureReason = context.failureReason !== undefined
    ? context.failureReason
    : normalizeText(session.runtime?.error || '');
  const recoveryGuidance = context.recoveryGuidance !== undefined
    ? context.recoveryGuidance
    : buildRecoveryGuidance(errorCategory);

  session.summary = buildSummaryFromSession(session, {
    toState: session.state,
    errorCategory,
    failureReason,
    recoveryGuidance,
    outputPath: normalizeText(context.outputPath || session.summary?.outputPath || buildSessionOutputPath(session.sessionId)),
  });

  if (context.persistOutput) {
    session.summary.outputPath = persistSessionTranscript(session, session.summary.outputPath);
  }

  if (context.persistCatalog) {
    schedulePersistCatalog();
  }
}

function persistSessionTranscript(session, outputPath) {
  const paths = buildSessionOutputStreamPaths(session.sessionId, outputPath);
  const stdout = normalizeText(session.runtime?.output?.stdout || '');
  const stderr = normalizeText(session.runtime?.output?.stderr || '');
  const transcript = buildSessionTranscript(session);
  persistOutputArtifact(paths.combined, transcript);
  persistOutputArtifact(paths.stdout, stdout);
  persistOutputArtifact(paths.stderr, stderr);
  return paths.combined;
}

function computeSessionDurationMs(session) {
  const startedAt = Date.parse(session.runtime?.startedAt || session.createdAt || session.updatedAt);
  const completedAt = Date.parse(
    session.runtime?.completedAt || session.completedAt || nowIso(),
  );
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) {
    return 0;
  }
  return Math.max(0, completedAt - startedAt);
}

function normalizeSummaryRecord(summary, fallback = {}) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return null;
  }

  return {
    durationMs: Number.isFinite(Number(summary.durationMs))
      ? Number(summary.durationMs)
      : 0,
    exitCode: Number.isFinite(Number(summary.exitCode))
      ? Number(summary.exitCode)
      : null,
    outputPath: normalizeText(summary.outputPath || fallback.outputPath || ''),
    transcript: normalizeText(summary.transcript || ''),
    failed: normalizeBoolean(summary.failed),
    errorCategory: normalizeText(summary.errorCategory || '') || null,
    recoveryGuidance: normalizeText(summary.recoveryGuidance || '') || null,
    failureReason: normalizeText(summary.failureReason || '') || null,
  };
}

function buildSummaryFromSession(session, context = {}) {
  const outputPath = normalizeText(context.outputPath || buildSessionOutputPath(session.sessionId));
  const terminalState = normalizeText(context.toState || session.state);

  return {
    durationMs: computeSessionDurationMs(session),
    exitCode: Number.isFinite(Number(session.runtime?.exitCode))
      ? Number(session.runtime.exitCode)
      : null,
    outputPath,
    transcript: buildSessionTranscript(session),
    failed: terminalState === 'failed',
    errorCategory: normalizeText(context.errorCategory || '') || null,
    recoveryGuidance: buildRecoveryGuidance(context.errorCategory, context.recoveryGuidance),
    failureReason: normalizeText(context.failureReason || context.error || '') || null,
  };
}

function readSessionOutput(session, stream = 'combined') {
  const fallback = buildSessionTranscript(session);
  const outputPath = resolveSessionOutputPath(session);
  if (!outputPath) {
    return fallback;
  }

  const normalizedStream = normalizeText(stream || 'combined').toLowerCase();
  const streamKey = normalizedStream === 'stdout' || normalizedStream === 'out'
    ? 'stdout'
    : normalizedStream === 'stderr' || normalizedStream === 'err'
      ? 'stderr'
      : 'combined';
  const streamPaths = buildSessionOutputStreamPaths(session.sessionId, outputPath);
  const candidatePath = streamPaths[streamKey];

  try {
    const persisted = fs.readFileSync(candidatePath, 'utf8');
    const resolved = normalizeText(persisted);
    if (streamKey === 'combined') {
      return resolved || fallback;
    }
    return resolved;
  } catch {
    return streamKey === 'combined' ? fallback : '';
  }
}

function buildPersistableSession(session) {
  ensureTerminalSummary(session, { persistOutput: false, persistCatalog: false });

  const runtime = session.runtime || {};
  const orchestrator = session.orchestrator || makeEmptyOrchestratorState();

  return {
    sessionId: session.sessionId,
    profile: session.profile,
    workingDirectory: session.workingDirectory,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt || nowIso(),
    task: session.task,
    taskIntent: session.taskIntent,
    profileHint: session.profileHint,
    orchestrator: {
      provider: orchestrator.provider || null,
      model: orchestrator.model || null,
      traceId: orchestrator.traceId || null,
      confidence: Number.isFinite(Number(orchestrator.confidence))
        ? Number(orchestrator.confidence)
        : null,
      selectedProfile: orchestrator.selectedProfile || null,
      requiresConfirmation: normalizeBoolean(orchestrator.requiresConfirmation),
      decision: orchestrator.decision || null,
      planDecision: orchestrator.planDecision || null,
      reason: orchestrator.reason || null,
      suggestedArgs: normalizeArgs(orchestrator.suggestedArgs) || null,
      latencyMs: Number.isFinite(Number(orchestrator.latencyMs))
        ? Number(orchestrator.latencyMs)
        : null,
      category: orchestrator.category || null,
      error: orchestrator.error || null,
      planAt: orchestrator.planAt || null,
    },
    stateHistory: Array.isArray(session.stateHistory) ? session.stateHistory.slice() : [],
    runtime: {
      command: runtime.command || '',
      args: normalizeArgs(runtime.args) || [],
      taskArgToken: runtime.taskArgToken || '',
      timeoutMs: Number.isFinite(Number(runtime.timeoutMs))
        ? Math.max(1000, Number(runtime.timeoutMs))
        : DEFAULT_TIMEOUT_MS,
      timeoutHandle: null,
      stopRequested: normalizeBoolean(runtime.stopRequested),
      output: {
        stdout: normalizeText(runtime.output?.stdout || ''),
        stderr: normalizeText(runtime.output?.stderr || ''),
      },
      exitCode: Number.isFinite(Number(runtime.exitCode)) ? Number(runtime.exitCode) : null,
      signal: runtime.signal || null,
      error: runtime.error || null,
      startedAt: runtime.startedAt || null,
      completedAt: runtime.completedAt || null,
      retryCount: Number.isFinite(Number(runtime.retryCount)) ? Number(runtime.retryCount) : 0,
      lastRetryError: runtime.lastRetryError || null,
      timer: null,
      process: null,
      queuedForStart: normalizeBoolean(runtime.queuedForStart),
      queuedForStartAt: runtime.queuedForStartAt || null,
      queuedStartOptions: normalizeObject(runtime.queuedStartOptions),
      awaitingManualConfirmation: normalizeBoolean(runtime.awaitingManualConfirmation),
    },
    summary: normalizeSummaryRecord(session.summary, {
      outputPath: buildSessionOutputPath(session.sessionId),
    }),
    restoredAt: nowIso(),
    persistedAt: nowIso(),
  };
}

function persistCatalog() {
  const retentionResult = enforceSessionRetentionPolicy();
  if (retentionResult?.pruned > 0) {
    console.log(`ADHD session retention removed ${retentionResult.pruned} sessions.`);
  }

  const sessions = [...sessionCatalog.values()].map(buildPersistableSession);
  const payload = JSON.stringify(sessions, null, 2);
  const payloadPath = SESSION_PERSIST_PATH;
  const payloadDir = path.dirname(payloadPath);

  try {
    fs.mkdirSync(payloadDir, { recursive: true });
    fs.writeFileSync(payloadPath, payload, 'utf8');
  } catch {
    return;
  }
}

function enforceSessionRetentionPolicy() {
  if (!sessionCatalog.size) return { pruned: 0 };

  if (!ADHD_SESSION_RETENTION_DAYS && !ADHD_SESSION_RETENTION_MAX_COUNT) {
    return { pruned: 0 };
  }

  const ageCutoff = ADHD_SESSION_RETENTION_DAYS
    ? Date.now() - (ADHD_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    : null;
  const terminalEntries = [...sessionCatalog.entries()].filter(([, session]) =>
    TERMINAL_SESSION_STATES.has(session?.state)
    && session
  );

  const normalizedEntries = terminalEntries
    .map(([sessionId, session]) => {
      const createdAt = Date.parse(session.createdAt || '');
      return {
        sessionId,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        session,
      };
    })
    .sort((left, right) => left.createdAt - right.createdAt);

  const removeSessionIds = new Set();

  if (ageCutoff !== null) {
    for (const item of normalizedEntries) {
      if (item.createdAt < ageCutoff) {
        removeSessionIds.add(item.sessionId);
      }
    }
  }

  const remainingForCount = normalizedEntries
    .filter((item) => !removeSessionIds.has(item.sessionId));
  if (ADHD_SESSION_RETENTION_MAX_COUNT > 0 && remainingForCount.length > ADHD_SESSION_RETENTION_MAX_COUNT) {
    const excess = remainingForCount.length - ADHD_SESSION_RETENTION_MAX_COUNT;
    for (let index = 0; index < excess; index += 1) {
      removeSessionIds.add(remainingForCount[index].sessionId);
    }
  }

  let pruned = 0;
  for (const sessionId of removeSessionIds) {
    if (sessionCatalog.delete(sessionId)) {
      pruned += 1;
    }
  }

  return { pruned };
}

function schedulePersistCatalog() {
  if (sessionPersistTimer) return;
  sessionPersistTimer = setTimeout(() => {
    sessionPersistTimer = null;
    persistCatalog();
  }, SESSION_PERSIST_WRITE_DELAY_MS);
}

function normalizeRestoredState(session) {
  if (!session || typeof session !== 'object') return null;

  const sessionId = normalizeText(session.sessionId || '');
  const profile = normalizeProfile(session.profile);
  const state = SESSION_STATES.has(session.state) ? session.state : runtimeDefaults.state;
  const workingDirectory = normalizeWorkingDirectory(session.workingDirectory);
  const createdAt = normalizeText(session.createdAt || '') || nowIso();
  const profileTemplate = resolveProfileTemplate(profile);

  if (!sessionId || !profile || !workingDirectory || !createdAt) {
    return null;
  }

  const task = normalizeText(session.task || '');
  const taskIntent = {
    rawText: normalizeText(session.taskIntent?.rawText || task || 'restored session'),
    normalizedText: normalizeText(session.taskIntent?.normalizedText || task || 'restored session'),
    source: normalizeText(session.taskIntent?.source || 'restored'),
    workType: normalizeText(session.taskIntent?.workType || ''),
    target: session.taskIntent?.target == null ? null : normalizeText(session.taskIntent.target),
    constraints: normalizeObject(session.taskIntent?.constraints || {}),
  };

  const normalized = {
    sessionId,
    profile,
    workingDirectory,
    state,
    createdAt,
    updatedAt: normalizeText(session.updatedAt || '') || nowIso(),
    task: task || taskIntent.normalizedText,
    taskIntent,
    profileHint: normalizeText(session.profileHint || ''),
    orchestrator: {
      ...makeEmptyOrchestratorState(),
      ...(normalizeObject(session.orchestrator) || {}),
    },
    stateHistory: Array.isArray(session.stateHistory) ? session.stateHistory : [],
    runtime: {
      command: normalizeText(session.runtime?.command || profileTemplate?.command),
      args: normalizeArgs(session.runtime?.args) || (profileTemplate ? profileTemplate.args.slice() : []),
      taskArgToken: normalizeText(session.runtime?.taskArgToken || profileTemplate?.taskArgToken),
      timeoutMs: Number.isFinite(Number(session.runtime?.timeoutMs))
        ? Math.max(1000, Number(session.runtime.timeoutMs))
        : DEFAULT_TIMEOUT_MS,
      timeoutHandle: null,
      stopRequested: normalizeBoolean(session.runtime?.stopRequested),
      output: {
        stdout: normalizeText(session.runtime?.output?.stdout || ''),
        stderr: normalizeText(session.runtime?.output?.stderr || ''),
      },
      exitCode: Number.isFinite(Number(session.runtime?.exitCode)) ? Number(session.runtime.exitCode) : null,
      signal: session.runtime?.signal || null,
      error: session.runtime?.error || null,
      startedAt: session.runtime?.startedAt || null,
      completedAt: session.runtime?.completedAt || null,
      retryCount: Number.isFinite(Number(session.runtime?.retryCount))
        ? Number(session.runtime.retryCount)
        : 0,
      lastRetryError: session.runtime?.lastRetryError || null,
      timer: null,
      process: null,
      queuedForStart: normalizeBoolean(session.runtime?.queuedForStart),
      queuedForStartAt: session.runtime?.queuedForStartAt || null,
      queuedStartOptions: normalizeObject(session.runtime?.queuedStartOptions),
      awaitingManualConfirmation: normalizeBoolean(session.runtime?.awaitingManualConfirmation),
    },
    summary: normalizeSummaryRecord(session.summary, {
      outputPath: buildSessionOutputPath(sessionId),
    }),
    _restored: true,
  };

  ensureTerminalSummary(normalized, {
    errorCategory: normalizeText(session.orchestrator?.category || ''),
    failureReason: normalizeText(session.runtime?.error || ''),
    outputPath: normalized.summary?.outputPath || buildSessionOutputPath(sessionId),
    persistOutput: false,
    persistCatalog: false,
  });

  return normalized;
}

function recoverActiveRestoredSession(session) {
  if (!session) return;
  const recoveredAt = nowIso();
  if (session.state === 'running' || session.state === 'starting') {
    const previous = session.state;
    const recoveryError = `Recovered from server restart while in ${previous} state.`;
    session.runtime.error = recoveryError;
    session.runtime.stopRequested = false;
    session.runtime.exitCode = null;
    session.runtime.signal = null;
    session.runtime.process = null;
    session.runtime.timeoutHandle = null;
    session.runtime.timer = null;
    session.runtime.awaitingManualConfirmation = false;
    if (canTransition(previous, 'failed')) {
      transitionSession(session, 'failed', 'startup-recovery');
    } else {
      session.state = 'failed';
      session.stateHistory.push({
        from: previous,
        to: session.state,
        at: recoveredAt,
        reason: 'startup-recovery',
      });
      session.updatedAt = recoveredAt;
      session.completedAt = recoveredAt;
    }
    ensureTerminalSummary(session, {
      errorCategory: 'server-restart',
      failureReason: recoveryError,
      outputPath: session.summary?.outputPath || buildSessionOutputPath(session.sessionId),
      persistOutput: true,
      persistCatalog: true,
    });
    return;
  }

  session.runtime.process = null;
  session.runtime.timeoutHandle = null;
  session.runtime.timer = null;
  session.runtime.stopRequested = false;
  session.updatedAt = recoveredAt;
}

function loadPersistedSessions() {
  try {
    const raw = fs.readFileSync(SESSION_PERSIST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const candidate of parsed) {
      const session = normalizeRestoredState(candidate);
      if (!session) continue;
      recoverActiveRestoredSession(session);
      sessionCatalog.set(session.sessionId, session);
    }
    const retentionResult = enforceSessionRetentionPolicy();
    if (retentionResult?.pruned > 0) {
      console.log(`ADHD session retention removed ${retentionResult.pruned} sessions on startup.`);
      persistCatalog();
    }
  } catch {
    return;
  }
}

const runtimeDefaults = {
  profile: 'basic',
  workingDirectory: process.env.HOME || process.cwd(),
  state: DEFAULT_STATE,
};

function eventSseWrite(res, event, payload = {}) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify({ ...payload, at: nowIso() })}\n\n`);
  } catch (error) {
    // best-effort stream writes
  }
}

function broadcastSessionEvent(event, payload = {}) {
  if (!SESSION_EVENT_CLIENTS.size) return;

  const serializedPayload = {
    ...payload,
    at: nowIso(),
  };
  const frameData = `data: ${JSON.stringify(serializedPayload)}\n\n`;
  const eventHeader = `event: ${event}\n`;

  for (const client of [...SESSION_EVENT_CLIENTS]) {
    if (!client || client.writableEnded || client.destroyed) {
      SESSION_EVENT_CLIENTS.delete(client);
      continue;
    }
    try {
      client.write(eventHeader);
      client.write(frameData);
    } catch {
      SESSION_EVENT_CLIENTS.delete(client);
    }
  }
}

function startSessionEventsStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  });

  SESSION_EVENT_CLIENTS.add(res);
  eventSseWrite(res, 'snapshot', { sessions: listSessions() });

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat);
      SESSION_EVENT_CLIENTS.delete(res);
      return;
    }
    try {
      res.write(`: ${nowIso()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      SESSION_EVENT_CLIENTS.delete(res);
    }
  }, SESSION_EVENTS_KEEPALIVE_MS);

  res.on('close', () => {
    clearInterval(heartbeat);
    SESSION_EVENT_CLIENTS.delete(res);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    SESSION_EVENT_CLIENTS.delete(res);
  });
}

function broadcastMobileSessionEvent(event, payload = {}) {
  if (!MOBILE_SESSION_EVENT_CLIENTS.size) return;

  const safePayload = { ...payload };
  if (safePayload.session) {
    safePayload.session = emitMobileSessionProjection(safePayload.session);
  }

  const serializedPayload = {
    ...safePayload,
    at: nowIso(),
  };
  const frameData = `data: ${JSON.stringify(serializedPayload)}\n\n`;
  const eventHeader = `event: ${event}\n`;

  for (const client of [...MOBILE_SESSION_EVENT_CLIENTS]) {
    if (!client || client.writableEnded || client.destroyed) {
      MOBILE_SESSION_EVENT_CLIENTS.delete(client);
      continue;
    }

    try {
      client.write(eventHeader);
      client.write(frameData);
    } catch {
      MOBILE_SESSION_EVENT_CLIENTS.delete(client);
    }
  }
}

function startMobileSessionEventsStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  });

  MOBILE_SESSION_EVENT_CLIENTS.add(res);
  eventSseWrite(res, 'snapshot', { sessions: listMobileSessions() });

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat);
      MOBILE_SESSION_EVENT_CLIENTS.delete(res);
      return;
    }
    try {
      res.write(`: ${nowIso()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      MOBILE_SESSION_EVENT_CLIENTS.delete(res);
    }
  }, SESSION_EVENTS_KEEPALIVE_MS);

  res.on('close', () => {
    clearInterval(heartbeat);
    MOBILE_SESSION_EVENT_CLIENTS.delete(res);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    MOBILE_SESSION_EVENT_CLIENTS.delete(res);
  });
}

function makeEmptyOrchestratorState() {
  return {
    provider: null,
    model: null,
    traceId: null,
    confidence: null,
    selectedProfile: null,
    requiresConfirmation: null,
    decision: null,
    reason: null,
    suggestedArgs: null,
    latencyMs: null,
    category: null,
    error: null,
    planAt: null,
  };
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

function safePublicPath(urlPath, publicDir = PUBLIC_DIR) {
  let decoded;

  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }

  const normalized = path.normalize(decoded).replace(/^\/+/, '');
  const resolved = path.join(publicDir, normalized);
  const rel = path.relative(publicDir, resolved);

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }

  return resolved;
}

function shouldServeSpaFallback(req) {
  const accept = String(req.headers.accept || '');
  const pathname = (req.url || '').split('?')[0] || '/';
  const hasNoExtension = path.extname(pathname) === '';
  return accept.includes('text/html') || hasNoExtension;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeWorkingDirectory(value) {
  if (!value) return runtimeDefaults.workingDirectory;
  if (value === '${HOME}') return runtimeDefaults.workingDirectory;
  return value;
}

function normalizeProfile(value) {
  const profile = String(value || runtimeDefaults.profile);
  return SESSION_PROFILES.has(profile) ? profile : null;
}

function normalizeExplicitProfile(value) {
  const normalized = normalizeText(value || '');
  return SESSION_PROFILES.has(normalized) ? normalized : null;
}

function normalizeErrorCategory(value) {
  return normalizeText(value || '');
}

function buildRecoveryGuidance(category, fallback = '') {
  const normalized = normalizeErrorCategory(category);
  if (ERROR_GUIDANCE_BY_CATEGORY[normalized]) {
    return ERROR_GUIDANCE_BY_CATEGORY[normalized];
  }
  const fallbackValue = normalizeText(fallback);
  return fallbackValue || ERROR_GUIDANCE_BY_CATEGORY.unknown;
}

function isTransportError(error = {}) {
  const code = normalizeText(error.code || error.cause?.code);
  const normalizedName = normalizeText(error.name || '').toLowerCase();
  const normalizedMessage = normalizeText(error.message || '').toLowerCase();

  const transportCodes = new Set([
    'econnrefused',
    'econnreset',
    'enotfound',
    'eai_again',
    'ehostunreach',
    'enetunreach',
    'econnaborted',
    'econnreset',
    'etimedout',
    'enetworkunreachable',
  ]);

  if (transportCodes.has(code)) return true;
  if (normalizedName === 'aborterror') return true;
  if (normalizedName === 'typeerror') return normalizedMessage.includes('failed to fetch');
  return /network|fetch|connection|connect|timed out|timeout|socket|econn|ehostunreach|enetunreach/i.test(
    error.message || '',
  );
}

function classifyRunnerSpawnError(error, command = '') {
  const code = normalizeText(error?.code || '');
  if (code === 'enoent') {
    return 'missing-tool';
  }
  return normalizeText(command) ? 'runner-spawn' : 'runner-spawn';
}

function extractTextCandidate(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return normalizeText(String(value));
  }
  if (Array.isArray(value) || typeof value !== 'object') {
    return '';
  }

  return extractTextCandidate(
    value.rawText
      || value.text
      || value.transcript
      || value.value
      || value.input
      || value.message
      || value.normalizedText
      || value.content,
  );
}

function resolveSubmitTaskText(payload = {}) {
  const transcriptText = extractTextCandidate(payload.transcript);
  if (transcriptText) return transcriptText;

  const candidates = [
    payload.taskText,
    payload.text,
    payload.task,
    payload.rawText,
    payload.message,
    payload.input,
    payload.value,
    payload.commandText,
    payload.statement,
  ];

  for (const candidate of candidates) {
    const text = extractTextCandidate(candidate);
    if (text) return text;
  }

  return extractTextCandidate(payload.taskIntent);
}

function resolveTaskTextContract(payload = {}) {
  const rawText = trimTask(resolveSubmitTaskText(payload));
  return {
    rawText,
    normalizedText: normalizeIntentText(rawText),
  };
}

function resolveSubmitProfile(payload = {}, options = {}) {
  const candidateProfile = normalizeExplicitProfile(payload.profile)
    || normalizeExplicitProfile(payload.activeProfile)
    || normalizeExplicitProfile(payload.selectedProfile)
    || normalizeExplicitProfile(payload.profileId)
    || normalizeExplicitProfile(payload.mode)
    || normalizeExplicitProfile(payload.taskIntent?.profile)
    || normalizeExplicitProfile(payload.taskIntent?.selectedProfile);

  if (candidateProfile) return candidateProfile;

  const routedProfile = normalizeExplicitProfile(options.routedProfile);
  if (routedProfile) return routedProfile;

  const inferredFromHint = normalizeExplicitProfile(payload.profileHint)
    || normalizeExplicitProfile(payload.taskIntent?.profileHint);
  if (inferredFromHint) return inferredFromHint;

  return null;
}

function normalizeWorkType(value) {
  const normalized = normalizeText(
    String(value || '')
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' '),
  );
  return normalized || null;
}

function normalizeWorkTypeForMatch(value) {
  const normalized = normalizeWorkType(value || '');
  return normalized ? ` ${normalized} ` : '';
}

function matchesWorkTypeTerm(haystack, term) {
  const normalizedHaystack = normalizeWorkTypeForMatch(haystack);
  const normalizedTerm = normalizeWorkTypeForMatch(term);
  return !!(normalizedHaystack && normalizedTerm && normalizedHaystack.includes(normalizedTerm));
}

function detectPathCandidates(text) {
  const normalized = normalizeText(text || '');
  if (!normalized) return [];

  return [...new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.replace(/^[\"'`(]+|[\"'`.,;:!?)]*$/g, ''))
      .filter((token) => /^(?:\.{1,2}\/|\/|~\/|~)/.test(token)),
  )];
}

function resolveIntentTarget(payloadTarget, taskText, fallbackDirectory) {
  const explicitTarget = normalizeText(payloadTarget || '');
  if (explicitTarget) {
    return {
      target: normalizeWorkingDirectory(explicitTarget),
      source: 'payload',
      constraints: {
        targetExplicit: true,
        targetCandidates: [explicitTarget],
      },
    };
  }

  const candidates = detectPathCandidates(taskText);
  if (candidates.length === 1) {
    return {
      target: normalizeWorkingDirectory(candidates[0]),
      source: 'inferred',
      constraints: {
        targetExplicit: false,
        targetInferred: true,
        targetCandidates: candidates,
      },
    };
  }

  if (candidates.length > 1) {
    return {
      target: normalizeWorkingDirectory(fallbackDirectory),
      source: 'ambiguous',
      constraints: {
        targetExplicit: false,
        targetCandidates: candidates,
        targetAmbiguous: true,
        targetSelection: 'ambiguous',
        targetDefaultedToWorkspace: true,
      },
    };
  }

  return {
    target: normalizeWorkingDirectory(fallbackDirectory),
    source: 'default',
    constraints: {
      targetExplicit: false,
      targetInferred: false,
      targetSelection: 'default',
      targetDefaultedToWorkspace: true,
    },
  };
}

function inferWorkTypeAndProfile(text, explicitWorkType) {
  const normalizedText = normalizeText(text || '');
  const normalizedTextForMatch = normalizeWorkTypeForMatch(normalizedText);
  if (explicitWorkType) {
    const normalizedWorkType = normalizeWorkType(explicitWorkType);
    const explicitProfile = mapWorkTypeToProfile(normalizedWorkType);
    return {
      workType: normalizedWorkType,
      routedProfile: explicitProfile,
      explicitWorkType: true,
    };
  }

  for (const rule of PROFILE_WORKTYPE_RULES) {
    if (rule.terms.some((term) => matchesWorkTypeTerm(normalizedTextForMatch, term))) {
      return {
        workType: rule.profile === 'edit' ? 'edit' : rule.profile === 'git' ? 'git' : 'release',
        routedProfile: rule.profile,
        explicitWorkType: false,
      };
    }
  }

  return { workType: null, routedProfile: null, explicitWorkType: false };
}

function mapWorkTypeToProfile(workType) {
  const normalized = normalizeWorkType(workType || '');
  if (!normalized) return null;
  if (SESSION_PROFILES.has(normalized)) return normalized;
  const directRule = PROFILE_WORKTYPE_RULES.find((rule) => rule.profile === normalized);
  if (directRule) return directRule.profile;
  const termMatch = PROFILE_WORKTYPE_RULES.find((rule) =>
    rule.terms.some((term) => matchesWorkTypeTerm(normalized, term)),
  );
  if (termMatch) return termMatch.profile;
  return null;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function normalizeArgs(value) {
  if (!Array.isArray(value)) return null;
  return value.map((part) => String(part));
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function parseConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return null;
  if (confidence < 0 || confidence > 1) return null;
  return confidence;
}

function isExplicitHighRiskRequest(payload = {}) {
  const constraints = normalizeObject(
    payload.taskIntent?.constraints || payload.constraints || payload.taskConstraints || {},
  );

  return (
    normalizeBoolean(payload.highRisk)
    || normalizeBoolean(payload.forceHighRisk)
    || normalizeBoolean(payload.explicitHighRisk)
    || normalizeBoolean(constraints.highRisk)
    || normalizeBoolean(constraints.forceHighRisk)
    || normalizeBoolean(constraints.forceHighRiskLaunch)
  );
}

function estimateRiskLevel(profile, decision) {
  if (profile === 'release') return 'high';
  return decision === ORCHESTRATOR_PLAN_DECISION.requiresConfirmation ? 'medium' : 'low';
}

function buildRiskSummary(profile, confidence, decision, reason) {
  const level = estimateRiskLevel(profile, decision);
  if (level === 'high') {
    return `High-risk profile '${profile}'. Confidence ${confidence == null ? 'n/a' : confidence.toFixed(2)}. ${reason || 'Requires manual confirmation.'}`;
  }
  if (level === 'medium') {
    return `Requires confirmation before launch. Confidence ${confidence == null ? 'n/a' : confidence.toFixed(2)}. ${reason || ''}`.trim();
  }
  return `Safe for auto-run. Confidence ${confidence == null ? 'n/a' : confidence.toFixed(2)}. ${reason || ''}`.trim();
}

function parseStartQueuePolicy(value) {
  const normalized = String(value || 'queue').trim().toLowerCase();
  if (normalized === 'reject' || normalized === 'hard-fail') {
    return 'reject';
  }
  return 'queue';
}

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseRetryLimit(value, fallback = 1) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseTimeoutTerminalState(value) {
  const normalized = normalizeText(value || 'failed').toLowerCase();
  return normalized === 'cancelled' || normalized === 'failed' ? normalized : 'failed';
}

function resolvePlanDecision(profile, confidence, requestedConfirmation = false) {
  const threshold = ORCHESTRATOR_PLAN_THRESHOLD[profile] ?? 0.9;
  if (profile === 'release') {
    return ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
  }

  if (requestedConfirmation) return ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
  if (confidence >= threshold) return ORCHESTRATOR_PLAN_DECISION.autoRun;
  return ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
}

function normalizeRiskAwarePlan(plan, options = {}) {
  const explicitHighRisk = normalizeBoolean(options.explicitHighRisk);
  if (!explicitHighRisk) return plan;

  const reason = (typeof plan?.reason === 'string' && plan.reason.trim())
    ? plan.reason
    : 'Explicit high-risk request requires confirmation before launch.';

  return {
    ...plan,
    requiresConfirmation: true,
    decision: ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
    planDecision: ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
    reason,
  };
}

function stripCodeFences(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function looksLikePlanPayload(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }

  return (
    candidate.profile !== undefined
    || candidate.selectedProfile !== undefined
    || candidate.recommendedProfile !== undefined
    || candidate.confidence !== undefined
    || candidate.requiresConfirmation !== undefined
    || candidate.requires_confirmation !== undefined
    || candidate.args !== undefined
    || candidate.suggestedArgs !== undefined
    || candidate.commandArgs !== undefined
    || candidate.reason !== undefined
    || candidate.summary !== undefined
  );
}

function parsePlanContent(value) {
  const raw = stripCodeFences(value);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parsePlanCandidate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = parsePlanContent(value);
    return looksLikePlanPayload(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    if (looksLikePlanPayload(value)) return value;
    if (typeof value.content === 'string') {
      const parsedFromContent = parsePlanContent(value.content);
      if (looksLikePlanPayload(parsedFromContent)) return parsedFromContent;
    }
    if (typeof value.text === 'string') {
      const parsedFromText = parsePlanContent(value.text);
      if (looksLikePlanPayload(parsedFromText)) return parsedFromText;
    }
  }
  return null;
}

function buildOrchestratorPlanPayload(session) {
  return {
    model: normalizeText(session?.model || ''),
    messages: [
      {
        role: 'system',
        content: [
          'You are a strict planning assistant for a trusted local orchestrator.',
          'Return JSON only, no markdown.',
          'Given a user task and requested profile, return:',
          'profile, confidence, requiresConfirmation, reason.',
          'profile must be one of basic|edit|git|release.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: session.task,
            requestedProfile: session.profile,
            profileHint: session.profileHint,
            source: session.taskIntent.source,
            workType: session.taskIntent.workType,
            target: session.taskIntent.target,
            constraints: session.taskIntent.constraints,
          },
          null,
          0,
        ),
      },
    ],
    temperature: 0,
    max_tokens: 300,
    top_p: 1,
  };
}

function buildOrchestratorInvocation(session, config = {}) {
  const provider = normalizeText(config.provider || 'ollama');
  const adapterModel = normalizeText(config.model || '');
  const requestPayload = buildOrchestratorPlanPayload({ ...session, model: adapterModel });

  return {
    provider,
    endpoint: buildOrchestratorEndpoint(config, config.chatPath || ORCHESTRATOR_PLAN_ENDPOINT_PATH),
    headers: buildOrchestratorHeaders(config),
    payload: requestPayload,
    timeoutMs: Math.max(1000, Number.isFinite(Number(ORCHESTRATOR_TIMEOUT_MS)) ? Number(ORCHESTRATOR_TIMEOUT_MS) : 15000),
  };
}

function extractPlanFromResponse(payload) {
  const candidates = [
    payload?.message,
    payload?.content,
    payload?.choices?.[0]?.message,
    payload?.choices?.[0]?.text,
    payload?.choices?.[0]?.message?.content,
    payload,
  ];
  for (const candidate of candidates) {
    const parsedCandidate = parsePlanCandidate(candidate);
    if (parsedCandidate) return parsedCandidate;
  }

  return null;
}

async function runOrchestratorPlan(session) {
  const startAt = Date.now();
  const config = resolveOrchestratorConfig();
  if (config.invalid) {
    throw Object.assign(new Error(`Orchestrator configuration is invalid: ${config.invalidReason || 'missing configuration'}`), {
      category: 'orchestrator-unavailable',
      provider: config.provider,
    });
  }
  const invocation = buildOrchestratorInvocation(session, config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), invocation.timeoutMs);

  let rawResponse;
  try {
    rawResponse = await fetch(invocation.endpoint, {
      method: 'POST',
      headers: invocation.headers,
      body: JSON.stringify(invocation.payload),
      signal: controller.signal,
    });
  } catch (error) {
    const planningCategory = isTransportError(error) ? 'transport-loss' : 'orchestrator-unavailable';
    throw Object.assign(new Error(`Orchestrator call failed: ${error.message}`), {
      category: planningCategory,
      provider: config.provider,
    });
  } finally {
    clearTimeout(timer);
  }

  const responseText = await rawResponse.text().catch(() => '');

  if (!rawResponse.ok) {
    const bodyText = responseText || 'unknown-body';
    throw Object.assign(new Error(`Orchestrator returned ${rawResponse.status}: ${bodyText}`), {
      category: 'orchestrator-unavailable',
      provider: config.provider,
    });
  }

  let body;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    throw Object.assign(new Error(`Orchestrator response was not valid JSON: ${error.message}`), {
      category: 'orchestrator-invalid-plan',
      provider: config.provider,
    });
  }
  const candidate = extractPlanFromResponse(body);
  if (!candidate) {
    throw Object.assign(new Error('Orchestrator response did not contain a usable planning payload'), {
      category: 'orchestrator-invalid-plan',
      provider: config.provider,
    });
  }

  const candidateProfile = normalizeProfile(
    candidate.profile || candidate.selectedProfile || candidate.recommendedProfile,
  );
  const requestedProfile = normalizeProfile(session.profile) || candidateProfile;
  const enforceHighRiskProfile = requestedProfile === 'release';
  const effectiveProfile = enforceHighRiskProfile ? 'release' : candidateProfile || requestedProfile;
  const confidence = parseConfidence(candidate.confidence);
  if (effectiveProfile == null) {
    throw Object.assign(new Error('Orchestrator profile is missing or invalid'), {
      category: 'orchestrator-invalid-plan',
      provider: config.provider,
    });
  }
  if (confidence === null) {
    throw Object.assign(new Error('Orchestrator confidence is missing or invalid'), {
      category: 'orchestrator-invalid-plan',
      provider: config.provider,
      errorCode: ORCHESTRATOR_PLANNING_BLOCKED_ERROR_CODE,
    });
  }

  const requestedConfirmation = enforceHighRiskProfile
    ? true
    : normalizeBoolean(
      candidate.requiresConfirmation ?? candidate.requires_confirmation,
    );
  const requiresConfirmation = requestedConfirmation;
  const decision = resolvePlanDecision(effectiveProfile, confidence, requiresConfirmation);
  const latencyMs = Date.now() - startAt;
  const reason = normalizeText(candidate.reason || candidate.summary || 'No reason provided');
  const suggestedArgs = normalizeArgs(candidate.args || candidate.suggestedArgs || candidate.commandArgs);

  return {
    provider: config.provider,
    model: config.model,
    traceId: body.id || null,
    selectedProfile: effectiveProfile,
    confidence,
    requiresConfirmation,
    planDecision: decision,
    decision,
    reason,
    latencyMs,
    category: 'orchestrator-ok',
    suggestedArgs,
  };
}

function buildPlanPreview(session, plan, options = {}) {
  const profile = normalizeProfile(plan?.selectedProfile) || session.profile;
  const template = resolveProfileTemplate(profile)
    || resolveProfileTemplate(session.profile)
    || { command: '', args: [], taskArgToken: '' };
  const normalizedOptions = normalizeStartRequest(options);
  const suggestedArgs = Array.isArray(normalizedOptions.args) && normalizedOptions.args.length
    ? normalizedOptions.args
    : Array.isArray(plan?.suggestedArgs) && plan.suggestedArgs.length
      ? plan.suggestedArgs.slice()
      : template.args.slice();
  const command = normalizeText(normalizedOptions.command || template.command);
  const timeoutMs = Number.isFinite(Number(normalizedOptions.timeoutMs))
    ? Math.max(1000, Number(normalizedOptions.timeoutMs))
    : session.runtime.timeoutMs;
  const projectedSession = {
    ...session,
    profile,
    runtime: {
      ...session.runtime,
      command,
      args: suggestedArgs,
      taskArgToken: template.taskArgToken,
      timeoutMs,
    },
  };
  const invocation = buildRunnerInvocation(projectedSession, {
    command,
    args: suggestedArgs,
    timeoutMs,
    env: normalizedOptions.env,
    workingDirectory: normalizedOptions.workingDirectory || session.workingDirectory,
  });
  const confidence = parseConfidence(plan?.confidence);
  const requiresConfirmation = normalizeBoolean(plan?.requiresConfirmation);
  const decision = plan?.decision || resolvePlanDecision(profile, confidence ?? 0, requiresConfirmation);
  const riskLevel = estimateRiskLevel(profile, decision);

  return {
    profile,
    command: invocation.command,
    args: invocation.args,
    workingDirectory: invocation.cwd,
    timeoutMs: invocation.timeoutMs,
    provider: plan?.provider || null,
    model: plan?.model || null,
    confidence,
    reason: plan?.reason || null,
    requiresConfirmation: decision === ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
    planDecision: decision,
    riskLevel,
    riskSummary: buildRiskSummary(profile, confidence, decision, plan?.reason),
    latencyMs: Number.isFinite(Number(plan?.latencyMs)) ? Number(plan.latencyMs) : null,
  };
}

async function previewSessionStart(sessionId, options = {}) {
  const session = sessionCatalog.get(sessionId);
  if (!session) {
    return { ok: false, status: 404, error: `Session not found: ${sessionId}` };
  }

  if (!canStartFromState(session)) {
    return startSessionError(
      409,
      `Cannot preview from state: ${session.state}`,
      session,
      false,
      null,
      { decision: ORCHESTRATOR_PLAN_DECISION.requiresConfirmation },
      null,
      'invalid-state',
      buildRecoveryGuidance('invalid-state'),
    );
  }

  try {
    const previewOptions = normalizeStartRequest(options);
    const explicitHighRisk = isExplicitHighRiskRequest({
      ...options,
      ...previewOptions,
      taskIntent: session.taskIntent,
    });
    const rawPlan = await runOrchestratorPlan(session);
    const plan = normalizeRiskAwarePlan(rawPlan, { explicitHighRisk });
    return {
      ok: true,
      session: getSession(sessionId),
      plan: buildPlanPreview(session, plan, previewOptions),
    };
  } catch (error) {
    const config = resolveOrchestratorConfig();
    const planningErrorCode = error?.errorCode;
    const planningErrorCategory = planningErrorCode || error.category || 'orchestrator-unavailable';
    const planningFailureReason = planningErrorCode === ORCHESTRATOR_PLANNING_BLOCKED_ERROR_CODE
      ? planningErrorCode
      : 'planner-failed';
    const planningFailurePlanDecision = planningErrorCode === ORCHESTRATOR_PLANNING_BLOCKED_ERROR_CODE
      ? null
      : ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
    session.orchestrator = {
      ...(session.orchestrator || makeEmptyOrchestratorState()),
      provider: config.provider,
      model: config.model,
      confidence: null,
      selectedProfile: session.profile,
      requiresConfirmation: null,
      decision: ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
      reason: error.message,
      traceId: null,
      latencyMs: null,
      category: planningErrorCategory,
      error: error.message,
      planAt: nowIso(),
    };
    return startSessionError(
      500,
      `Orchestrator failed: ${error.message}`,
      session,
      false,
      planningFailureReason === ORCHESTRATOR_PLANNING_BLOCKED_ERROR_CODE
        ? null
        : ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
      null,
      planningErrorCode || null,
      planningErrorCategory,
      buildRecoveryGuidance(planningErrorCategory),
    );
  }
}

function makeSessionId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makePairingToken() {
  return randomBytes(16).toString('hex');
}

function getPairToken(token) {
  const normalized = normalizeText(token);
  if (!normalized) return null;

  const record = ACTIVE_PAIR_TOKENS.get(normalized);
  if (!record) return null;
  if (!Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
    ACTIVE_PAIR_TOKENS.delete(normalized);
    return null;
  }
  record.lastUsedAt = nowIso();
  return record;
}

function issuePairToken(ttlMs) {
  const ttl = Number.isFinite(Number(ttlMs))
    ? Math.max(1000, Number.parseInt(String(ttlMs), 10))
    : API_PAIRING_TTL_MS;
  const issuedAt = nowIso();
  const issuedAtMs = Date.now();
  const token = makePairingToken();
  const expiresAt = issuedAtMs + ttl;
  ACTIVE_PAIR_TOKENS.set(token, {
    issuedAt,
    issuedAtMs,
    expiresAt,
    expiresInMs: ttl,
    lastUsedAt: issuedAt,
  });
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInMs: ttl,
  };
}

function normalizeActionId(value) {
  return normalizeText(value);
}

function mobileClientId(req) {
  const token = extractApiToken(req);
  if (token) {
    return `token:${token}`;
  }
  return `ip:${req?.socket?.remoteAddress || 'unknown'}`;
}

function makeMobileActionCacheKey(req, action, sessionId, actionId = '') {
  const requestId = normalizeActionId(actionId);
  if (!requestId) return '';
  return `${mobileClientId(req)}|${sessionId}|${action}|${requestId}`;
}

function cleanupMobileActionCache() {
  const now = Date.now();
  for (const [key, record] of MOBILE_ACTION_CACHE.entries()) {
    if (!record?.createdAt || !Number.isFinite(Number(record.createdAt))) continue;
    if (record.createdAt + MOBILE_ACTION_IDEMPOTENCY_TTL_MS < now) {
      MOBILE_ACTION_CACHE.delete(key);
    }
  }
}

function getCachedMobileActionResponse(cacheKey) {
  if (!cacheKey) return null;
  cleanupMobileActionCache();
  return MOBILE_ACTION_CACHE.get(cacheKey) || null;
}

function setMobileActionResponse(cacheKey, statusCode, payload) {
  if (!cacheKey) return;
  cleanupMobileActionCache();
  MOBILE_ACTION_CACHE.set(cacheKey, {
    status: statusCode,
    payload,
    createdAt: Date.now(),
  });
}

function retryActionCacheKey(sessionId) {
  const safeSessionId = normalizeText(sessionId || '');
  if (!safeSessionId) return '';
  return `retry|${safeSessionId}`;
}

function cleanupRetryActionCache() {
  const now = Date.now();
  for (const [key, record] of SESSION_RETRY_ACTION_CACHE.entries()) {
    if (!record?.createdAt || !Number.isFinite(Number(record.createdAt))) continue;
    if (record.createdAt + RETRY_SESSION_ACTION_TTL_MS < now) {
      SESSION_RETRY_ACTION_CACHE.delete(key);
    }
  }
}

function getCachedRetryActionSession(sessionId) {
  const key = retryActionCacheKey(sessionId);
  if (!key) return null;

  cleanupRetryActionCache();
  const record = SESSION_RETRY_ACTION_CACHE.get(key);
  if (!record || !record.sessionId) return null;
  return sessionCatalog.get(record.sessionId) || null;
}

function setRetryActionSession(sessionId, retriedSessionId) {
  const key = retryActionCacheKey(sessionId);
  if (!key) return;
  cleanupRetryActionCache();
  SESSION_RETRY_ACTION_CACHE.set(key, {
    sessionId: retriedSessionId,
    createdAt: Date.now(),
  });
}

function rerunActionCacheKey(sessionId, profile = '') {
  const safeSessionId = normalizeText(sessionId || '');
  if (!safeSessionId) return '';
  const safeProfile = normalizeProfile(profile) || '';
  return safeProfile ? `rerun|${safeSessionId}|${safeProfile}` : `rerun|${safeSessionId}`;
}

function cleanupRerunActionCache() {
  const now = Date.now();
  for (const [key, record] of SESSION_RERUN_ACTION_CACHE.entries()) {
    if (!record?.createdAt || !Number.isFinite(Number(record.createdAt))) continue;
    if (record.createdAt + RETRY_SESSION_ACTION_TTL_MS < now) {
      SESSION_RERUN_ACTION_CACHE.delete(key);
    }
  }
}

function getCachedRerunActionSession(sessionId, profile = '') {
  const key = rerunActionCacheKey(sessionId, profile);
  if (!key) return null;

  cleanupRerunActionCache();
  const record = SESSION_RERUN_ACTION_CACHE.get(key);
  if (!record || !record.sessionId) return null;
  return sessionCatalog.get(record.sessionId) || null;
}

function setRerunActionSession(sessionId, rerunSessionId, profile = '') {
  const key = rerunActionCacheKey(sessionId, profile);
  if (!key) return;
  cleanupRerunActionCache();
  SESSION_RERUN_ACTION_CACHE.set(key, {
    sessionId: rerunSessionId,
    createdAt: Date.now(),
  });
}

function emitMobileSessionProjection(session = {}) {
  if (!session || typeof session !== 'object') return session;
  const safe = scrubSessionForTransport(session);
  const state = normalizeText(safe.state || '');
  if (safe.progress !== undefined) return safe;

  if (state === 'queued') {
    safe.progress = 15;
  } else if (state === 'awaiting_confirmation') {
    safe.progress = 25;
  } else if (state === 'starting') {
    safe.progress = 35;
  } else if (state === 'running') {
    safe.progress = 65;
  } else if (state === 'completed') {
    safe.progress = 100;
  } else if (state === 'cancelled') {
    safe.progress = 100;
  } else if (state === 'failed') {
    safe.progress = 100;
  } else {
    safe.progress = 0;
  }

  safe.outputLength = normalizeText(safe.runtime?.output?.stdout || '').length
    + normalizeText(safe.runtime?.output?.stderr || '').length;
  safe.progressLabel = state === 'running'
    ? 'running'
    : state === 'awaiting_confirmation'
      ? 'awaiting confirmation'
      : state;
  return safe;
}

function emitResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function isLoopbackAddress(value) {
  if (!value) return false;
  const normalized = String(value).replace(/^::ffff:/, '');
  return LOCAL_API_HOSTS.has(normalized);
}

function extractApiToken(req) {
  const tokenHeader = req.headers.authorization || req.headers[API_AUTH_HEADER];
  if (!tokenHeader) return '';
  if (Array.isArray(tokenHeader)) {
    return String(tokenHeader[0] || '').trim();
  }
  const token = String(tokenHeader);
  if (/^bearer\s+/i.test(token)) {
    return token.replace(/^bearer\s+/i, '').trim();
  }
  return token.trim();
}

function isApiAuthorized(req) {
  if (isLoopbackAddress(req?.socket?.remoteAddress)) {
    return { ok: true };
  }

  const presentedToken = extractApiToken(req);
  if (API_TOKEN && presentedToken && presentedToken === API_TOKEN) {
    return { ok: true };
  }

  if (getPairToken(presentedToken)) {
    return { ok: true };
  }

  if (!API_TOKEN) {
    if (!presentedToken) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Pairing token required for non-local API access.',
      };
    }
    return {
      ok: false,
      statusCode: 403,
      error: 'Invalid or expired pairing token.',
    };
  }

  if (!presentedToken) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Missing API token for non-local API access.',
    };
  }

  if (presentedToken !== API_TOKEN) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Invalid API token for non-local API access.',
    };
  }

  return { ok: true };
}

function canStartFromState(session) {
  return session.state === 'queued' || session.state === 'awaiting_confirmation';
}

function collectBodyRequestError(error) {
  const isPayloadTooLarge = error?.statusCode === 413;
  return {
    statusCode: isPayloadTooLarge ? 413 : 400,
    message: isPayloadTooLarge
      ? 'Payload Too Large'
      : `Invalid JSON: ${error?.message || 'Bad request'}`,
  };
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let dataLength = 0;
    const chunks = [];

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };

    const onAborted = () => {
      cleanup();
      const aborted = new Error('Request aborted');
      aborted.statusCode = 400;
      reject(aborted);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onData = (chunk) => {
      const chunkLength = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      dataLength += chunkLength;

      if (dataLength > MAX_BODY_SIZE) {
        cleanup();
        req.destroy();
        const tooLarge = new Error('Payload Too Large');
        tooLarge.statusCode = 413;
        reject(tooLarge);
        return;
      }

      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    };

    const onEnd = () => {
      cleanup();
      const data = Buffer.concat(chunks).toString('utf8');
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

function appendOutput(session, stream, chunk) {
  const text = String(chunk || '');
  if (!text) return;
  const current = session.runtime.output?.[stream] || '';
  const combined = `${current}${text}`;
  session.runtime.output[stream] = combined.length > MAX_OUTPUT_CHARS
    ? combined.slice(-MAX_OUTPUT_CHARS)
    : combined;
  schedulePersistCatalog();
  broadcastSessionEvent('session-output', {
    sessionId: session.sessionId,
    stream,
    delta: text,
    output: session.runtime.output,
    session: getSession(session.sessionId),
  });
  broadcastMobileSessionEvent('session-output', {
    sessionId: session.sessionId,
    stream,
    delta: text,
    output: session.runtime.output,
    session: getSession(session.sessionId),
  });
}

function trimTask(text) {
  return normalizeText(text || '');
}

function normalizeIntentText(text) {
  const normalized = normalizeText(text || '');
  if (!normalized) return '';

  return normalized
    .split(/\s+/)
    .map((token) =>
      token
        .replace(/^[“"']+|[”"']+$/g, '')
        .replace(/^[`(]+|[)\],.;:!?]+$/g, '')
        .replace(/^[\[\{]+|[\]\}]+$/g, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' ');
}

function resolveArgTemplateTokens(args, taskText) {
  if (!Array.isArray(args)) return [];
  if (!taskText) return args.slice();

  return args.flatMap((arg) => {
    if (arg !== CODEX_TASK_PLACEHOLDER) return arg;
    return [taskText];
  });
}

function hydrateSessionPayload(payload = {}) {
  const workingDirectory = normalizeWorkingDirectory(payload.workingDirectory);
  const taskTextContract = resolveTaskTextContract(payload);
  const rawTask = taskTextContract.rawText;
  const normalizedTask = taskTextContract.normalizedText;
  const payloadWorkType = payload.taskIntent?.workType || payload.workType || '';
  const payloadTarget = payload.taskIntent?.target || payload.target || null;
  const payloadConstraints = normalizeObject(payload.taskIntent?.constraints || payload.constraints);
  const payloadCommand = normalizeText(payload.command || payload.runtimeCommand || payload.commandPath || '');
  const payloadTaskArgToken = normalizeText(payload.taskArgToken || payload.commandTaskArgToken || '');
  const submittedArgs = normalizeArgs(payload.flags || payload.args || payload.startupArgs || payload.commandArgs || payload.commandArguments);
  const explicitHighRisk = isExplicitHighRiskRequest({
    highRisk: payload.highRisk,
    forceHighRisk: payload.forceHighRisk,
    explicitHighRisk: payload.explicitHighRisk,
    constraints: payloadConstraints,
    taskIntent: payload.taskIntent || {},
  });

  const inferredIntentTarget = resolveIntentTarget(payloadTarget, normalizedTask, workingDirectory);
  const inferred = inferWorkTypeAndProfile(normalizedTask, payloadWorkType);
  const profile = resolveSubmitProfile(payload, { routedProfile: inferred.routedProfile });

  if (!profile) {
    return {
      ok: false,
      error: `Profile is required to create a session. Expected one of: ${PROFILE_SUGGESTIONS.join(', ')}`,
      errorCategory: 'invalid-profile',
      recoveryGuidance: buildRecoveryGuidance('invalid-profile'),
      profileSuggestions: PROFILE_SUGGESTIONS,
      taskIntent: {
        rawText: rawTask,
        normalizedText: normalizedTask,
        workType: inferred.workType,
        source: payload.source || 'setup-stub',
        target: inferredIntentTarget.target,
        constraints: {
          ...(payloadConstraints || {}),
          ...(inferredIntentTarget.constraints || {}),
          ...(explicitHighRisk ? { highRisk: true } : {}),
          workTypeSource: inferred.explicitWorkType ? 'payload' : 'heuristic',
        },
        profileSuggestions: PROFILE_SUGGESTIONS,
      },
    };
  }

  const profileTemplate = resolveProfileTemplate(profile);
  const runtimeArgs = submittedArgs || (profileTemplate ? profileTemplate.args.slice() : []);
  const runtimeTaskArgToken = payloadTaskArgToken || profileTemplate?.taskArgToken || '';
  const command = payloadCommand || profileTemplate?.command || 'codex';
  const workType = inferred.workType || (inferredIntentTarget.source === 'default' ? 'basic' : null);
  const profileHintFromInput = payload.profileHint || payload.taskIntent?.profileHint || null;
  const source = normalizeText(payload.source || payload.taskIntent?.source || 'setup-stub');
  const constraints = {
    ...(payloadConstraints || {}),
    ...(inferredIntentTarget.constraints || {}),
  };
  if (explicitHighRisk) {
    constraints.highRisk = true;
  }

  const session = {
    sessionId: makeSessionId(),
    profile,
    workingDirectory,
    state: runtimeDefaults.state,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    task: normalizedTask,
    taskIntent: {
      rawText: rawTask,
      normalizedText: normalizedTask,
      workType,
      target: inferredIntentTarget.target,
      constraints,
      source,
      profileSuggestions: PROFILE_SUGGESTIONS,
    },
    profileHint: profileHintFromInput || null,
    orchestrator: makeEmptyOrchestratorState(),
    stateHistory: [
      {
        from: null,
        to: runtimeDefaults.state,
        at: nowIso(),
        reason: 'bootstrapped',
      },
    ],
    runtime: {
      command,
      args: runtimeArgs,
      taskArgToken: runtimeTaskArgToken,
      timeoutMs: Number.isFinite(Number(payload.timeoutMs))
        ? Math.max(1000, Number(payload.timeoutMs))
        : DEFAULT_TIMEOUT_MS,
      timeoutHandle: null,
      stopRequested: false,
      output: { stdout: '', stderr: '' },
      exitCode: null,
      signal: null,
      error: null,
      startedAt: null,
      completedAt: null,
      timer: null,
      retryCount: 0,
      lastRetryError: null,
      process: null,
      queuedForStart: false,
      queuedForStartAt: null,
      queuedStartOptions: null,
      awaitingManualConfirmation: false,
    },
  };

  return { ok: true, session };
}

function validateSession(session) {
  if (!session.sessionId) return 'Missing sessionId';
  if (!SESSION_PROFILES.has(session.profile)) return `Invalid profile: ${session.profile}`;
  if (!session.workingDirectory) return 'Invalid workingDirectory';
  if (!SESSION_STATES.has(session.state)) return `Invalid state: ${session.state}`;
  if (!session.createdAt) return 'Missing createdAt';
  return null;
}

function canTransition(from, to) {
  return SESSION_TRANSITIONS[from]?.has(to);
}

function transitionSession(session, to, reason = 'system') {
  const previousState = session.state;
  if (!canTransition(session.state, to)) {
    throw new Error(`Invalid transition ${session.state} -> ${to}`);
  }

  session.stateHistory.push({
    from: session.state,
    to,
    at: nowIso(),
    reason,
  });
  session.state = to;
  session.updatedAt = nowIso();

  if (to === 'running') {
    session.startedAt = nowIso();
  }

  if (to === 'completed' || to === 'failed' || to === 'cancelled') {
    session.completedAt = nowIso();
  }

  if (to === 'starting' || to === 'running' || to === 'awaiting_confirmation' || to === 'queued') {
    persistCatalog();
  } else {
    schedulePersistCatalog();
  }
  broadcastSessionEvent('session-state', {
    from: previousState,
    to,
    reason,
    session: getSession(session.sessionId),
  });
  broadcastMobileSessionEvent('session-state', {
    from: previousState,
    to,
    reason,
    session: getSession(session.sessionId),
  });
  return session;
}

function clearStartRequest(session) {
  session.runtime.queuedForStart = false;
  session.runtime.queuedForStartAt = null;
  session.runtime.queuedStartOptions = null;
  schedulePersistCatalog();
}

function normalizeStartRequest(value = {}) {
  const timeoutMs = Number.isFinite(Number(value.timeoutMs))
    ? Math.max(1000, Number(value.timeoutMs))
    : null;

  return {
    command: normalizeText(value.command),
    args: normalizeArgs(value.args || value.commandArgs || value.commandArguments),
    timeoutMs,
    env: normalizeObject(value.env),
    workingDirectory: value.workingDirectory ? normalizeWorkingDirectory(value.workingDirectory) : null,
  };
}

function canAcceptRunnerSlot() {
  const active = [...sessionCatalog.values()].filter((session) =>
    session.state === 'starting' || session.state === 'running'
  ).length;
  return active < MAX_CONCURRENT_SESSIONS;
}

function queuedStartCandidates() {
  return [...sessionCatalog.values()]
    .filter((session) => session.runtime?.queuedForStart)
    .filter((session) => session.state === 'queued'
      || (session.state === 'awaiting_confirmation' && !session.runtime?.awaitingManualConfirmation));
}

function queueStatusPayload() {
  const queued = queuedStartCandidates();
  const active = [...sessionCatalog.values()].filter((session) =>
    session.state === 'starting' || session.state === 'running'
  ).length;

  return {
    policy: START_QUEUE_POLICY,
    maxConcurrentSessions: MAX_CONCURRENT_SESSIONS,
    activeCount: active,
    queuedCount: queued.length,
  };
}

function runQueuedStartRequests() {
  if (!canAcceptRunnerSlot()) return;

  const candidates = queuedStartCandidates()
    .sort((a, b) => (a.runtime?.queuedForStartAt || a.createdAt).localeCompare(b.runtime?.queuedForStartAt || b.createdAt));

  for (const session of candidates) {
    if (!canAcceptRunnerSlot()) break;
    if (!canTransition(session.state, 'starting')) {
      clearStartRequest(session);
      continue;
    }

    const startOptions = session.runtime?.queuedStartOptions || {};
    transitionSession(session, 'starting', 'runner-slot-acquired');
    clearStartRequest(session);
    runCodexRunner(session, startOptions);
  }
}

function startRunnerNow(session, options = {}) {
  if (!canTransition(session.state, 'starting')) {
    return false;
  }

  clearStartRequest(session);
  transitionSession(session, 'starting', 'runner-started');
  runCodexRunner(session, {
    command: options.command,
    args: options.args,
    timeoutMs: options.timeoutMs,
    env: options.env,
    workingDirectory: options.workingDirectory,
  });
  return true;
}

function clearTimeoutHandle(session) {
  if (session.runtime.timeoutHandle) {
    clearTimeout(session.runtime.timeoutHandle);
    session.runtime.timeoutHandle = null;
  }
}

function clearExecutionProcess(session) {
  if (!session.runtime.process) return;
  if (!session.runtime.process.killed) {
    session.runtime.process.kill('SIGKILL');
  }
  session.runtime.process = null;
}

function scrubSessionForTransport(session) {
  const runtime = { ...session.runtime };
  runtime.process = runtime.process ? { pid: runtime.process.pid, killed: runtime.process.killed } : null;
  runtime.timeoutHandle = !!runtime.timeoutHandle;
  return { ...session, runtime };
}

function listSessions(filters = {}) {
  const profileFilter = normalizeProfile(filters.profile || '');
  const fromTimestamp = Number.isFinite(Date.parse(filters.from || ''))
    ? Date.parse(filters.from)
    : null;
  const toTimestamp = Number.isFinite(Date.parse(filters.to || ''))
    ? Date.parse(filters.to)
    : null;
  const sortMode = normalizeText(filters.sort || 'newest').toLowerCase();
  const sortDirection = sortMode === 'oldest' ? 1 : -1;

  return [...sessionCatalog.values()]
    .filter((session) => {
      if (profileFilter && normalizeProfile(session.profile) !== profileFilter) {
        return false;
      }
      const createdAt = Date.parse(session.createdAt || '');
      if (fromTimestamp !== null && (!Number.isFinite(createdAt) || createdAt < fromTimestamp)) {
        return false;
      }
      if (toTimestamp !== null && (!Number.isFinite(createdAt) || createdAt > toTimestamp)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftCreated = Date.parse(left.createdAt || '');
      const rightCreated = Date.parse(right.createdAt || '');
      const leftValue = Number.isFinite(leftCreated) ? leftCreated : 0;
      const rightValue = Number.isFinite(rightCreated) ? rightCreated : 0;
      if (leftValue === rightValue) return (left.sessionId || '').localeCompare(right.sessionId || '');
      return (leftValue - rightValue) * sortDirection;
    })
    .map((session) => {
      ensureTerminalSummary(session, { persistOutput: false, persistCatalog: false });
      return scrubSessionForTransport(session);
    });
}

function listMobileSessions() {
  return [...sessionCatalog.values()].map((session) => {
    ensureTerminalSummary(session, { persistOutput: false, persistCatalog: false });
    return emitMobileSessionProjection(session);
  });
}

function getSession(sessionId) {
  const session = sessionCatalog.get(sessionId);
  if (!session) return null;
  ensureTerminalSummary(session, { persistOutput: false, persistCatalog: false });
  return scrubSessionForTransport(session);
}

function getMobileSession(sessionId) {
  const session = sessionCatalog.get(sessionId);
  if (!session) return null;
  ensureTerminalSummary(session, { persistOutput: false, persistCatalog: false });
  return emitMobileSessionProjection(session);
}

function emitTextResponse(res, statusCode, body) {
  const text = typeof body === 'string' ? body : '';
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(text);
}

function createSession(sessionInput, options = {}) {
  const hydrated = options.preHydrated ? { ok: true, session: sessionInput } : hydrateSessionPayload(sessionInput);
  if (!hydrated.ok) return hydrated;

  const candidate = { ...hydrated.session };
  candidate.sessionId = candidate.sessionId || makeSessionId();
  while (sessionCatalog.has(candidate.sessionId)) {
    candidate.sessionId = makeSessionId();
  }

  const validationError = validateSession(candidate);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  sessionCatalog.set(candidate.sessionId, candidate);
  schedulePersistCatalog();
  return { ok: true, session: candidate };
}

function resolveRunnerArgs(session, options) {
  const template = resolveProfileTemplate(session.profile);
  const source = options || {};
  const rawArgs = normalizeArgs(source.args || source.commandArgs || source.commandArguments || session.runtime.args);
  const taskArgToken = source.taskArgToken || session.runtime.taskArgToken;
  const baseArgs = rawArgs ? rawArgs.slice() : (template?.args ? template.args.slice() : []);
  const withTaskTemplate = resolveArgTemplateTokens(baseArgs, session.task);

  if (!taskArgToken || !session.task) return withTaskTemplate;

  if (baseArgs.includes(CODEX_TASK_PLACEHOLDER)) return withTaskTemplate;
  return withTaskTemplate.concat([taskArgToken, session.task]);
}

function buildRunnerInvocation(session, options = {}) {
  const source = options || {};
  const template = resolveProfileTemplate(session.profile);
  const command = normalizeText(source.command || session.runtime.command || template?.command);

  if (!command) {
    throw new Error('No command configured for this session');
  }

  const args = resolveRunnerArgs(session, source);
  const timeoutMs = Number.isFinite(Number(source.timeoutMs))
    ? Math.max(1000, Number(source.timeoutMs))
    : session.runtime.timeoutMs;
  const workingDirectory = normalizeWorkingDirectory(source.workingDirectory || session.workingDirectory);

  return {
    command,
    args,
    timeoutMs,
    cwd: workingDirectory,
    env: normalizeObject(source.env),
  };
}

function applyOrchestratorPlan(session, plan) {
  const profile = normalizeProfile(plan.selectedProfile) || session.profile;
  const template = resolveProfileTemplate(profile);
  const runtimeArgs = Array.isArray(plan.suggestedArgs) && plan.suggestedArgs.length
    ? plan.suggestedArgs.slice()
    : (template ? template.args.slice() : session.runtime.args.slice());

  session.profile = profile;
  session.runtime.args = runtimeArgs;
  session.runtime.taskArgToken = template ? template.taskArgToken : session.runtime.taskArgToken;
  session.runtime.command = template?.command || session.runtime.command;
  session.orchestrator = {
    ...(session.orchestrator || makeEmptyOrchestratorState()),
    provider: plan.provider,
    model: plan.model,
    traceId: plan.traceId,
    confidence: plan.confidence,
    selectedProfile: plan.selectedProfile,
    requiresConfirmation: plan.requiresConfirmation,
    decision: plan.decision,
    planDecision: plan.decision,
    reason: plan.reason,
    suggestedArgs: runtimeArgs,
    latencyMs: plan.latencyMs,
    category: plan.category,
    error: null,
    planAt: nowIso(),
  };
  schedulePersistCatalog();
}

function startSessionError(
  status,
  error,
  session,
  requiresConfirmation = false,
  planDecision = null,
  planPreview = null,
  errorCode = null,
  errorCategory = null,
  recoveryGuidance = null,
) {
  const planContext = planPreview || {
    command: null,
    args: [],
    workingDirectory: null,
    timeoutMs: null,
    confidence: null,
    requiresConfirmation: null,
    reason: null,
  };
  schedulePersistCatalog();

  return {
    ok: false,
    status,
    error,
    errorCategory: normalizeErrorCategory(errorCategory) || null,
    recoveryGuidance: (() => {
      const normalizedCategory = normalizeErrorCategory(errorCategory);
      return normalizeText(recoveryGuidance)
        || (normalizedCategory ? buildRecoveryGuidance(normalizedCategory) : null);
    })(),
    requiresConfirmation,
    planDecision,
    errorCode,
    planPreview: planContext,
    session: getSession(session.sessionId),
  };
}

function finalizeSessionTerminal(session, toState, reason, processMetadata) {
  if (!session) return;
  if (session.state === 'completed' || session.state === 'failed' || session.state === 'cancelled') return;

  const target = canTransition(session.state, toState) ? toState : null;
  if (!target) return;
  transitionSession(session, target, reason);

  if (processMetadata?.exitCode !== undefined) {
    session.runtime.exitCode = processMetadata.exitCode;
  }

  if (processMetadata?.signal) {
    session.runtime.signal = processMetadata.signal;
  }
  if (processMetadata?.error) {
    session.runtime.error = processMetadata.error;
  }

  if (target === 'completed' || target === 'failed' || target === 'cancelled') {
    ensureTerminalSummary(session, {
      errorCategory: processMetadata?.errorCategory || session.runtime?.errorCategory,
      failureReason: processMetadata?.error || session.runtime?.error || '',
      outputPath: session.summary?.outputPath || buildSessionOutputPath(session.sessionId),
      persistOutput: true,
      persistCatalog: true,
    });
  }

  session.runtime.process = null;
  clearTimeoutHandle(session);
  runQueuedStartRequests();
}

function terminateProcess(session) {
  const proc = session.runtime.process;
  if (!proc) return;

  try {
    proc.kill('SIGTERM');
  } catch (error) {
    session.runtime.error = `Failed to terminate process: ${error.message}`;
  }

  setTimeout(() => {
    if (proc && !proc.killed) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // process likely already exited or denied; keep session state as caller requested
      }
    }
  }, 250);
}

function sleep(ms) {
  return new Promise((resolve) => {
    const delay = Number.isFinite(Number(ms)) ? Math.max(1, Number(ms)) : 0;
    setTimeout(resolve, delay);
  });
}

async function runCodexRunner(session, options = {}) {
  const maxRetries = RUNNER_RETRY_ENABLED ? RUNNER_MAX_RETRIES : 0;
  let attempt = 0;
  let processObj = null;
  let invocation;

  while (attempt <= maxRetries) {
    if (session.state !== 'starting' || session.runtime.stopRequested) {
      return;
    }

    try {
      invocation = buildRunnerInvocation(session, options);
      session.runtime.command = invocation.command;
      session.runtime.args = invocation.args;
      session.runtime.timeoutMs = invocation.timeoutMs;
      processObj = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        env: {
          ...process.env,
          ...invocation.env,
          ADHD_SESSION_ID: session.sessionId,
          ADHD_SESSION_PROFILE: session.profile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      session.runtime.process = processObj;
      if (session.state !== 'starting' || session.runtime.stopRequested) {
        terminateProcess(session);
        return;
      }
      session.runtime.startedAt = nowIso();
      session.runtime.lastRetryError = null;
      session.runtime.error = null;
      break;
    } catch (error) {
      if (session.state !== 'starting' || session.runtime.stopRequested) {
        return;
      }

      const spawnCategory = classifyRunnerSpawnError(error, invocation.command);
      session.runtime.retryCount = Number.isFinite(Number(session.runtime.retryCount))
        ? Number(session.runtime.retryCount) + 1
        : 1;
      session.runtime.lastRetryError = error.message;
      session.runtime.error = `Runner start attempt ${attempt + 1} failed: ${error.message}`;
      schedulePersistCatalog();

      if (attempt < maxRetries && session.state === 'starting' && !session.runtime.stopRequested) {
        await sleep(RUNNER_RETRY_DELAY_MS);
        attempt += 1;
        continue;
      }

      finalizeSessionTerminal(session, 'failed', 'spawn-error', {
        exitCode: -1,
        error: error.message,
        errorCategory: spawnCategory,
        recoveryGuidance: buildRecoveryGuidance(spawnCategory),
      });
      return;
    }
  }

  if (session.state !== 'starting') {
    terminateProcess(session);
    return;
  }

  if (!processObj) {
    return;
  }

  transitionSession(session, 'running', 'runner-started');

  processObj.stdout.on('data', (chunk) => {
    appendOutput(session, 'stdout', chunk);
  });

  processObj.stderr.on('data', (chunk) => {
    appendOutput(session, 'stderr', chunk);
  });

  processObj.on('error', (error) => {
    session.runtime.error = error.message;
    finalizeSessionTerminal(session, 'failed', 'runner-error', {
      error: error.message,
      errorCategory: 'runner-process-error',
    });
  });

  processObj.on('close', (code, signal) => {
    if (session.runtime.stopRequested && session.runtime.timeoutHandle === null) {
      session.runtime.exitCode = Number.isFinite(Number(code)) ? Number(code) : null;
      session.runtime.signal = signal || null;
      session.runtime.process = null;
      return;
    }

    if (session.state === 'cancelled') {
      session.runtime.exitCode = Number.isFinite(Number(code)) ? Number(code) : null;
      session.runtime.signal = signal || null;
      clearTimeoutHandle(session);
      session.runtime.process = null;
      return;
    }

    session.runtime.exitCode = Number.isFinite(Number(code)) ? Number(code) : null;
    session.runtime.signal = signal || null;
    session.runtime.process = null;
    clearTimeoutHandle(session);

    if (session.runtime.stopRequested) {
      finalizeSessionTerminal(session, 'cancelled', 'runner-stop-requested');
      return;
    }

    if (code === 0 && !signal) {
      finalizeSessionTerminal(session, 'completed', 'runner-complete', { exitCode: code });
      return;
    }

    finalizeSessionTerminal(session, 'failed', 'runner-error-exit', {
      exitCode: session.runtime.exitCode,
      signal,
      error: session.runtime.error || `Process exited with code ${code}`,
      errorCategory: signal ? 'runner-exit-signal' : 'runner-exit-nonzero',
    });
  });

  session.runtime.timeoutHandle = setTimeout(() => {
    if (
      session.state !== 'running'
      || session.runtime.stopRequested
      || !session.runtime.process
    ) {
      session.runtime.timeoutHandle = null;
      return;
    }

    const timeoutTerminalState = RUNNER_TIMEOUT_TERMINAL_STATE;
    const timeoutReason = timeoutTerminalState === 'cancelled'
      ? 'runner-timeout-cancelled'
      : 'runner-timeout-failed';
    session.runtime.stopRequested = true;
    session.runtime.error = `Timeout after ${session.runtime.timeoutMs}ms`;
    session.runtime.timeoutHandle = null;
    terminateProcess(session);
    finalizeSessionTerminal(session, timeoutTerminalState, timeoutReason, {
      exitCode: null,
      error: `Timeout after ${session.runtime.timeoutMs}ms`,
      errorCategory: timeoutTerminalState === 'failed'
        ? 'runner-timeout-failed'
        : 'runner-timeout-cancelled',
      recoveryGuidance: buildRecoveryGuidance(
        timeoutTerminalState === 'failed'
          ? 'runner-timeout-failed'
          : 'runner-timeout-cancelled',
      ),
    });
  }, session.runtime.timeoutMs);
}

async function startSession(sessionId, options = {}) {
  const session = sessionCatalog.get(sessionId);
  if (!session) {
    return { ok: false, status: 404, error: `Session not found: ${sessionId}` };
  }

  if (!canStartFromState(session)) {
    session.runtime.error = `Cannot start from state: ${session.state}`;
    return startSessionError(
      409,
      session.runtime.error,
      session,
      false,
      null,
      null,
      null,
      'invalid-state',
      buildRecoveryGuidance('invalid-state'),
    );
  }

  session.runtime.stopRequested = false;
  session.runtime.error = null;
  session.runtime.exitCode = null;
  session.runtime.signal = null;

  const confirm = normalizeBoolean(options.confirm);
  const explicitHighRisk = isExplicitHighRiskRequest({
    ...normalizeStartRequest(options),
    taskIntent: session.taskIntent,
    constraints: options.constraints,
    highRisk: options.highRisk,
    forceHighRisk: options.forceHighRisk,
    explicitHighRisk: options.explicitHighRisk,
  });
  let plan;

  try {
    const rawPlan = await runOrchestratorPlan(session);
    plan = normalizeRiskAwarePlan(rawPlan, { explicitHighRisk });
    if (!canStartFromState(session)) {
      session.runtime.error = `Cannot start from state: ${session.state}`;
      return startSessionError(
        409,
        session.runtime.error,
        session,
        false,
        null,
        null,
        null,
        'invalid-state',
        buildRecoveryGuidance('invalid-state'),
      );
    }

    applyOrchestratorPlan(session, plan);
    session.runtime.retryCount = 0;
    session.runtime.lastRetryError = null;
  } catch (error) {
    const config = resolveOrchestratorConfig();
    const planningErrorCode = error?.errorCode;
    const planningErrorCategory = planningErrorCode || error.category || 'orchestrator-unavailable';
    const planningFailureReason = planningErrorCode === ORCHESTRATOR_PLANNING_BLOCKED_ERROR_CODE
      ? planningErrorCode
      : 'planner-failed';
    const planningFailurePlanDecision = planningErrorCode === ORCHESTRATOR_PLANNING_BLOCKED_ERROR_CODE
      ? null
      : ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
    session.orchestrator = {
      ...(session.orchestrator || makeEmptyOrchestratorState()),
      provider: config.provider,
      model: config.model,
      confidence: null,
      selectedProfile: session.profile,
      requiresConfirmation: null,
      decision: ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
      reason: error.message,
      traceId: null,
      latencyMs: null,
      category: planningErrorCategory,
      error: error.message,
      planAt: nowIso(),
    };
    session.runtime.error = `Orchestrator failed: ${error.message}`;
    finalizeSessionTerminal(session, 'failed', planningFailureReason, {
      exitCode: null,
      error: error.message,
      errorCategory: planningErrorCategory,
    });
    return startSessionError(
      500,
      `Orchestrator failed: ${error.message}`,
      session,
      false,
      planningFailurePlanDecision,
      null,
      planningErrorCode || null,
      planningErrorCategory,
      buildRecoveryGuidance(planningErrorCategory),
    );
  }

  if (plan.decision === ORCHESTRATOR_PLAN_DECISION.requiresConfirmation && !confirm) {
    session.runtime.error = 'Execution requires confirmation from caller.';
    session.runtime.awaitingManualConfirmation = true;
    clearStartRequest(session);
    const preview = buildPlanPreview(session, plan, options);

    if (session.state !== 'awaiting_confirmation') {
      if (!canTransition(session.state, 'awaiting_confirmation')) {
        session.runtime.error = `Cannot transition session from ${session.state} to awaiting_confirmation`;
        return startSessionError(
          409,
          session.runtime.error,
          session,
          true,
          ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
          preview,
          null,
          'invalid-state',
          buildRecoveryGuidance('invalid-state'),
        );
      }
      transitionSession(session, 'awaiting_confirmation', 'planner-requires-confirmation');
    }
    return startSessionError(
      409,
      'Execution requires confirmation. Retry with { "confirm": true } to proceed.',
      session,
      true,
      ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
      preview,
      null,
      null,
      null,
    );
  }

  const startOptions = normalizeStartRequest({
    command: options.command,
    args: options.args ?? plan.suggestedArgs ?? options.commandArgs,
    timeoutMs: options.timeoutMs,
    env: options.env,
    workingDirectory: options.workingDirectory,
  });

  session.runtime.awaitingManualConfirmation = false;
  if (!canAcceptRunnerSlot()) {
    if (START_QUEUE_POLICY === 'reject') {
      clearStartRequest(session);
      return {
        ok: false,
        status: 429,
        error: 'Runner queue is full. Retry after capacity is available.',
        errorCode: QUEUE_FULL_ERROR_CODE,
        queueBlocked: true,
        queueStatus: queueStatusPayload(),
        session: getSession(sessionId),
      };
    }

    session.runtime.queuedForStart = true;
    session.runtime.queuedForStartAt = nowIso();
    session.runtime.queuedStartOptions = startOptions;
    return {
      ok: true,
      session: getSession(sessionId),
      queued: true,
      reason: 'runner slot full',
    };
  }

  if (!startRunnerNow(session, startOptions)) {
    return startSessionError(
      409,
      `Cannot transition session from ${session.state} to starting`,
      session,
      false,
      ORCHESTRATOR_PLAN_DECISION.autoRun,
      null,
      null,
      'invalid-state',
      buildRecoveryGuidance('invalid-state'),
    );
  }

  return { ok: true, session: getSession(sessionId) };
}

function stopSession(sessionId) {
  const session = sessionCatalog.get(sessionId);
  if (!session) {
    return { ok: false, status: 404, error: `Session not found: ${sessionId}` };
  }

  if (session.state === 'completed' || session.state === 'failed' || session.state === 'cancelled') {
    return { ok: true, session: getSession(sessionId) };
  }

  session.runtime.stopRequested = true;
  clearTimeoutHandle(session);
  terminateProcess(session);
  clearStartRequest(session);
  transitionSession(session, 'cancelled', 'user-stop-request');
  ensureTerminalSummary(session, {
    failureReason: normalizeText(session.runtime?.error || ''),
    outputPath: session.summary?.outputPath || buildSessionOutputPath(session.sessionId),
    persistOutput: true,
    persistCatalog: true,
  });
  return { ok: true, session: getSession(sessionId) };
}

function retrySession(sessionId) {
  const source = sessionCatalog.get(sessionId);
  if (!source) {
    return { ok: false, status: 404, error: `Session not found: ${sessionId}` };
  }

  const cachedRetrySession = getCachedRetryActionSession(sessionId);
  if (cachedRetrySession) {
    return {
      ok: true,
      session: getSession(cachedRetrySession.sessionId),
      retriedFrom: sessionId,
      deduplicated: true,
    };
  }

  if (source.state !== 'failed') {
    return {
      ok: false,
      status: 409,
      error: `Cannot retry session in state: ${source.state}`,
    };
  }

  const retryPayload = {
    profile: source.profile,
    workingDirectory: source.workingDirectory,
    task: source.task,
    taskText: source.task,
    taskIntent: {
      ...source.taskIntent,
      source: 'retry',
    },
    profileHint: source.profileHint,
    command: normalizeText(source.runtime?.command || ''),
    args: normalizeArgs(source.runtime?.args),
    taskArgToken: normalizeText(source.runtime?.taskArgToken || ''),
  };

  const hydrated = hydrateSessionPayload(retryPayload);
  if (!hydrated.ok) {
    return { ok: false, status: 400, error: `Failed to build retry payload: ${hydrated.error}` };
  }

  const created = createSession(hydrated.session, { preHydrated: true });
  if (!created.ok) {
    SESSION_RETRY_ACTION_CACHE.delete(retryActionCacheKey(sessionId));
    return { ok: false, status: 400, error: created.error };
  }

  setRetryActionSession(sessionId, created.session.sessionId);

  return { ok: true, session: getSession(created.session.sessionId), retriedFrom: sessionId };
}

function buildRerunPayload(sourceSession, options = {}) {
  const source = sourceSession && typeof sourceSession === 'object' ? sourceSession : null;
  if (!source) return { ok: false, status: 400, error: 'Source session is required' };

  const requestedProfile = normalizeProfile(options.profile || '');
  const sourceProfile = normalizeProfile(source.profile || '');
  const profile = requestedProfile || sourceProfile;

  if (!profile) {
    return { ok: false, status: 400, error: 'Invalid profile' };
  }
  if (!SESSION_PROFILES.has(profile)) {
    return { ok: false, status: 400, error: `Invalid profile: ${profile}` };
  }

  const sourceTemplate = sourceProfile ? resolveProfileTemplate(sourceProfile) : null;
  const rerunTemplate = resolveProfileTemplate(profile);
  const useRerunTemplate = profile !== sourceProfile;

  return {
    ok: true,
    session: {
      profile,
      workingDirectory: source.workingDirectory,
      task: source.task,
      taskText: source.task,
      taskIntent: {
        ...source.taskIntent,
        source: 'rerun',
      },
      profileHint: source.profileHint,
      command: normalizeText(useRerunTemplate
        ? (rerunTemplate?.command || source.runtime?.command || sourceTemplate?.command || 'codex')
        : source.runtime?.command || ''),
      args: useRerunTemplate
        ? normalizeArgs(rerunTemplate?.args)
        : normalizeArgs(source.runtime?.args),
      taskArgToken: normalizeText(useRerunTemplate
        ? (rerunTemplate?.taskArgToken || source.runtime?.taskArgToken || sourceTemplate?.taskArgToken)
        : source.runtime?.taskArgToken || ''),
    },
  };
}

function rerunSession(sessionId, options = {}) {
  const source = sessionCatalog.get(sessionId);
  if (!source) {
    return { ok: false, status: 404, error: `Session not found: ${sessionId}` };
  }

  if (!TERMINAL_SESSION_STATES.has(source.state)) {
    return {
      ok: false,
      status: 409,
      error: `Cannot rerun session in state: ${source.state}`,
    };
  }

  const normalizedProfile = normalizeProfile(options.profile || '');
  const cacheProfile = normalizedProfile || source.profile;
  const cachedRerunSession = getCachedRerunActionSession(sessionId, cacheProfile);
  if (cachedRerunSession) {
    return {
      ok: true,
      session: getSession(cachedRerunSession.sessionId),
      rerunFrom: sessionId,
      deduplicated: true,
    };
  }

  const rerunPayload = buildRerunPayload(source, { profile: normalizedProfile });
  if (!rerunPayload.ok) {
    return { ok: false, status: rerunPayload.status || 400, error: rerunPayload.error || 'Failed to build rerun payload' };
  }

  const hydrated = hydrateSessionPayload(rerunPayload.session);
  if (!hydrated.ok) {
    return { ok: false, status: 400, error: `Failed to build rerun payload: ${hydrated.error}` };
  }

  const created = createSession(hydrated.session, { preHydrated: true });
  if (!created.ok) {
    SESSION_RERUN_ACTION_CACHE.delete(rerunActionCacheKey(sessionId, cacheProfile));
    return { ok: false, status: 400, error: created.error };
  }

  setRerunActionSession(sessionId, created.session.sessionId, cacheProfile);

  return { ok: true, session: getSession(created.session.sessionId), rerunFrom: sessionId };
}

function mobileActionId(req) {
  return normalizeActionId(
    req?.headers?.[MOBILE_ACTION_ID_HEADER]
    || req?.headers?.[MOBILE_ACTION_ID_HEADER.toLowerCase()],
  );
}

function handleApiRequest(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = url.pathname;
  const parts = pathname.split('/').filter(Boolean);
  const sessionQuery = {
    profile: url.searchParams.get('profile'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    sort: url.searchParams.get('sort'),
  };

  if (
    req.method === 'POST'
    && parts[0] === 'api'
    && parts[1] === 'sessions'
    && parts[2] === 'intent'
    && parts.length === 3
  ) {
    return collectBody(req)
      .then(hydrateSessionPayload)
      .then((result) => {
        if (!result.ok) {
          emitResponse(res, 400, {
            ok: false,
            phase: 'session-runtime',
            ...result,
          });
          return;
        }

        const created = createSession(result.session, { preHydrated: true });
        if (!created.ok) {
          emitResponse(res, 400, {
            ok: false,
            phase: 'session-runtime',
            ...created,
          });
          return;
        }

        emitResponse(res, 201, { ok: true, session: getSession(created.session.sessionId) });
      })
      .catch((error) => {
        const parsed = collectBodyRequestError(error);
        emitResponse(res, parsed.statusCode, { ok: false, error: parsed.message });
      });
  }

  if (
    req.method === 'POST'
    && parts[0] === 'api'
    && parts[1] === 'pair'
    && parts[2] === 'request'
    && parts.length === 3
  ) {
    return collectBody(req)
      .then((body) => {
        if (!isLoopbackAddress(req?.socket?.remoteAddress)) {
          emitResponse(res, 403, {
            ok: false,
            error: 'Pairing token requests are restricted to loopback.',
          });
          return;
        }

        const issued = issuePairToken(body?.ttlMs);
        emitResponse(res, 201, {
          ok: true,
          token: issued.token,
          expiresAt: issued.expiresAt,
          expiresInMs: issued.expiresInMs,
          header: `Use this token as ${API_AUTH_HEADER}`,
        });
      })
      .catch((error) => {
        const parsed = collectBodyRequestError(error);
        emitResponse(res, parsed.statusCode, { ok: false, error: parsed.message });
      });
  }

  if (
    req.method === 'GET'
    && parts[0] === 'api'
    && parts[1] === 'mobile'
    && parts[2] === 'sessions'
    && parts.length === 3
  ) {
    emitResponse(res, 200, { ok: true, sessions: listMobileSessions() });
    return;
  }

  if (
    req.method === 'GET'
    && parts[0] === 'api'
    && parts[1] === 'mobile'
    && parts[2] === 'sessions'
    && parts.length === 4
    && parts[3] === 'events'
  ) {
    return startMobileSessionEventsStream(req, res);
  }

  if (
    req.method === 'GET'
    && parts[0] === 'api'
    && parts[1] === 'mobile'
    && parts[2] === 'sessions'
    && parts.length === 4
  ) {
    const session = getMobileSession(parts[3]);
    if (!session) {
      emitResponse(res, 404, { ok: false, error: `Session not found: ${parts[3]}` });
      return;
    }

    emitResponse(res, 200, { ok: true, session });
    return;
  }

  if (
    req.method === 'POST'
    && parts[0] === 'api'
    && parts[1] === 'mobile'
    && parts[2] === 'sessions'
    && parts.length === 5
  ) {
    const sessionId = parts[3];
    const action = parts[4];
    const cacheKey = makeMobileActionCacheKey(req, action, sessionId, mobileActionId(req));
    const cached = getCachedMobileActionResponse(cacheKey);

    if (cached) {
      emitResponse(res, cached.status, cached.payload);
      return;
    }

    const sendResponse = (statusCode, payload) => {
      const responsePayload = payload?.session ? {
        ...payload,
        session: emitMobileSessionProjection(payload.session),
      } : payload;
      setMobileActionResponse(cacheKey, statusCode, responsePayload);
      emitResponse(res, statusCode, responsePayload);
    };

    if (action === 'start') {
      return collectBody(req)
        .then((body) => startSession(sessionId, body || {}))
        .then((result) => {
          if (!result.ok) {
            const errorResponse = {
              ok: false,
              error: result.error,
            };
            if (result.requiresConfirmation) {
              errorResponse.requiresConfirmation = true;
              errorResponse.planDecision = ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
            }
            if (result.planDecision) {
              errorResponse.planDecision = result.planDecision;
            }
            if (result.session) {
              errorResponse.session = emitMobileSessionProjection(result.session);
            }
            if (result.queueStatus) {
              errorResponse.queueStatus = result.queueStatus;
            }
            if (result.errorCode) {
              errorResponse.errorCode = result.errorCode;
            }
            if (result.queueBlocked) {
              errorResponse.queueBlocked = result.queueBlocked;
            }
            if (result.planPreview) {
              errorResponse.planPreview = result.planPreview;
            }
            if (result.errorCategory) {
              errorResponse.errorCategory = result.errorCategory;
              errorResponse.recoveryGuidance = result.recoveryGuidance;
            }
            sendResponse(result.status || 400, errorResponse);
            return;
          }

          const successResponse = { ok: true, session: result.session };
          if (result.queued) {
            successResponse.queued = true;
            successResponse.reason = result.reason || 'start queued due to runner capacity';
            successResponse.queueStatus = queueStatusPayload();
          }
          successResponse.session = emitMobileSessionProjection(result.session);
          sendResponse(200, successResponse);
        })
        .catch((error) => {
          if (error?.statusCode === 413) {
            sendResponse(413, { ok: false, error: error.message || 'Payload Too Large' });
            return;
          }
          if (error?.statusCode) {
            sendResponse(error.statusCode, { ok: false, error: error.message || 'Bad request' });
            return;
          }
          if (error instanceof SyntaxError || (error?.message || '').toLowerCase().includes('json')) {
            sendResponse(400, { ok: false, error: `Invalid JSON: ${error.message}` });
            return;
          }
          sendResponse(500, { ok: false, error: error?.message || 'Internal server error' });
        });
    }

    if (action === 'cancel' || action === 'stop') {
      const result = stopSession(sessionId);
      if (!result.ok) {
        sendResponse(result.status || 400, { ok: false, error: result.error });
        return;
      }

      sendResponse(200, { ok: true, session: result.session });
      return;
    }

    if (action === 'retry') {
      const result = retrySession(sessionId);
      if (!result.ok) {
        sendResponse(result.status || 400, { ok: false, error: result.error });
        return;
      }

      sendResponse(201, {
        ok: true,
        session: result.session,
        retriedFrom: result.retriedFrom,
      });
      return;
    }

    if (action === 'rerun') {
      return collectBody(req)
        .then((body) => rerunSession(sessionId, body || {}))
        .then((result) => {
          if (!result.ok) {
            sendResponse(result.status || 400, { ok: false, error: result.error });
            return;
          }

          sendResponse(201, {
            ok: true,
            session: result.session,
            rerunFrom: result.rerunFrom,
          });
        })
        .catch((error) => {
          if (error?.statusCode === 413) {
            sendResponse(413, { ok: false, error: error.message || 'Payload Too Large' });
            return;
          }
          if (error?.statusCode) {
            sendResponse(error.statusCode, { ok: false, error: error.message || 'Bad request' });
            return;
          }
          if (error instanceof SyntaxError || (error?.message || '').toLowerCase().includes('json')) {
            sendResponse(400, { ok: false, error: `Invalid JSON: ${error.message}` });
            return;
          }
          sendResponse(500, { ok: false, error: error?.message || 'Internal server error' });
        });
    }

    emitResponse(res, 404, { ok: false, error: 'Unknown endpoint' });
    return;
  }

  if (parts[0] !== 'api' || parts[1] !== 'sessions') {
    emitResponse(res, 404, { ok: false, error: 'Unknown endpoint' });
    return;
  }

  if (req.method === 'GET' && parts.length === 2) {
    emitResponse(res, 200, { ok: true, sessions: listSessions(sessionQuery) });
    return;
  }

  if (
    req.method === 'GET'
    && parts.length === 3
    && parts[2] === 'events'
  ) {
    return startSessionEventsStream(req, res);
  }

  if (
    req.method === 'GET'
    && parts.length === 4
    && parts[3] === 'output'
  ) {
    const session = sessionCatalog.get(parts[2]);
    if (!session) {
      emitResponse(res, 404, { ok: false, error: `Session not found: ${parts[2]}` });
      return;
    }

    const output = readSessionOutput(session, url.searchParams.get('stream'));
    if (output === null) {
      emitResponse(res, 404, { ok: false, error: 'Session output is not available.' });
      return;
    }

    emitTextResponse(res, 200, output);
    return;
  }

  if (req.method === 'GET' && parts.length === 3) {
    const session = getSession(parts[2]);
    if (!session) {
      emitResponse(res, 404, { ok: false, error: `Session not found: ${parts[2]}` });
      return;
    }

    emitResponse(res, 200, { ok: true, session });
    return;
  }

  if (parts.length === 4 && req.method === 'POST') {
    const sessionId = parts[2];
    const action = parts[3];

    if (action === 'start') {
      return collectBody(req)
        .then((body) => startSession(sessionId, body || {}))
        .then((result) => {
          if (!result.ok) {
            const errorResponse = {
              ok: false,
              error: result.error,
            };
            if (result.requiresConfirmation) {
              errorResponse.requiresConfirmation = true;
              errorResponse.planDecision = ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
            }
            if (result.planDecision) {
              errorResponse.planDecision = result.planDecision;
            }
            if (result.session) {
              errorResponse.session = result.session;
            }
            if (result.queueStatus) {
              errorResponse.queueStatus = result.queueStatus;
            }
            if (result.errorCode) {
              errorResponse.errorCode = result.errorCode;
            }
            if (result.queueBlocked) {
              errorResponse.queueBlocked = result.queueBlocked;
            }
            if (result.planPreview) {
              errorResponse.planPreview = result.planPreview;
            }
            if (result.errorCategory) {
              errorResponse.errorCategory = result.errorCategory;
              errorResponse.recoveryGuidance = result.recoveryGuidance;
            }
            emitResponse(res, result.status || 400, errorResponse);
            return;
          }
          const successResponse = { ok: true, session: result.session };
          if (result.queued) {
            successResponse.queued = true;
            successResponse.reason = result.reason || 'start queued due to runner capacity';
            successResponse.queueStatus = queueStatusPayload();
          }
          emitResponse(res, 200, successResponse);
        })
        .catch((error) => {
          if (error?.statusCode === 413) {
            emitResponse(res, 413, { ok: false, error: error.message || 'Payload Too Large' });
            return;
          }
          if (error?.statusCode) {
            emitResponse(res, error.statusCode, { ok: false, error: error.message || 'Bad request' });
            return;
          }
          if (error instanceof SyntaxError || (error?.message || '').toLowerCase().includes('json')) {
            emitResponse(res, 400, { ok: false, error: `Invalid JSON: ${error.message}` });
            return;
          }
          emitResponse(res, 500, { ok: false, error: error?.message || 'Internal server error' });
        });
    }

    if (action === 'preview') {
      return collectBody(req)
        .then((body) => previewSessionStart(sessionId, body || {}))
        .then((result) => {
          if (!result.ok) {
            const errorResponse = {
              ok: false,
              error: result.error,
            };
            if (result.session) {
              errorResponse.session = result.session;
            }
            if (result.planDecision) {
              errorResponse.planDecision = result.planDecision;
            }
            if (result.errorCode) {
              errorResponse.errorCode = result.errorCode;
            }
            if (result.errorCategory) {
              errorResponse.errorCategory = result.errorCategory;
              errorResponse.recoveryGuidance = result.recoveryGuidance;
            }
            emitResponse(res, result.status || 400, errorResponse);
            return;
          }
          emitResponse(res, 200, { ok: true, session: result.session, plan: result.plan });
        })
        .catch((error) => {
          if (error?.statusCode === 413) {
            emitResponse(res, 413, { ok: false, error: error.message || 'Payload Too Large' });
            return;
          }
          if (error?.statusCode) {
            emitResponse(res, error.statusCode, { ok: false, error: error.message || 'Bad request' });
            return;
          }
          if (error instanceof SyntaxError || (error?.message || '').toLowerCase().includes('json')) {
            emitResponse(res, 400, { ok: false, error: `Invalid JSON: ${error.message}` });
            return;
          }
          emitResponse(res, 500, { ok: false, error: error?.message || 'Internal server error' });
        });
    }

    if (action === 'stop' || action === 'cancel') {
      const result = stopSession(sessionId);
      if (!result.ok) {
        emitResponse(res, result.status || 400, { ok: false, error: result.error });
        return;
      }

      emitResponse(res, 200, { ok: true, session: result.session });
      return;
    }

    if (action === 'retry') {
      const result = retrySession(sessionId);
      if (!result.ok) {
        emitResponse(res, result.status || 400, { ok: false, error: result.error });
        return;
      }

      emitResponse(res, 201, {
        ok: true,
        session: result.session,
        retriedFrom: result.retriedFrom,
      });
      return;
    }

    if (action === 'rerun') {
      return collectBody(req)
        .then((body) => rerunSession(sessionId, body || {}))
        .then((result) => {
          if (!result.ok) {
            emitResponse(res, result.status || 400, { ok: false, error: result.error });
            return;
          }

          emitResponse(res, 201, {
            ok: true,
            session: result.session,
            rerunFrom: result.rerunFrom,
          });
        })
        .catch((error) => {
          if (error?.statusCode === 413) {
            emitResponse(res, 413, { ok: false, error: error.message || 'Payload Too Large' });
            return;
          }
          if (error?.statusCode) {
            emitResponse(res, error.statusCode, { ok: false, error: error.message || 'Bad request' });
            return;
          }
          if (error instanceof SyntaxError || (error?.message || '').toLowerCase().includes('json')) {
            emitResponse(res, 400, { ok: false, error: `Invalid JSON: ${error.message}` });
            return;
          }
          emitResponse(res, 500, { ok: false, error: error?.message || 'Internal server error' });
        });
    }
  }

  emitResponse(res, 404, { ok: false, error: 'Unknown endpoint' });
}

function isApiMethod(method) {
  return method === 'GET' || method === 'POST';
}

export const createServer = (options = {}) => {
  const publicDir = options.publicDir || PUBLIC_DIR;

  return http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (req.url.startsWith('/api/')) {
      const auth = isApiAuthorized(req);
      if (!auth.ok) {
        emitResponse(res, auth.statusCode, { ok: false, error: auth.error });
        return;
      }

      if (!isApiMethod(req.method || '')) {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed on API routes in setup runtime.' }));
        return;
      }

      return handleApiRequest(req, res);
    }

    const requestPathname = req.url.split('?')[0] || '/';
    const targetPath = requestPathname === '/'
      ? path.join(publicDir, 'index.html')
      : safePublicPath(req.url, publicDir);

    if (!targetPath) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    fs.readFile(targetPath, (err, file) => {
      if (err) {
        if (requestPathname !== '/' && shouldServeSpaFallback(req)) {
          fs.readFile(path.join(publicDir, 'index.html'), (fallbackErr, fallback) => {
            if (fallbackErr) {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Not Found');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fallback);
          });
          return;
        }

        const statusCode = (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? 404 : 500;
        res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(statusCode === 404 ? 'Not Found' : 'Internal Server Error');
        return;
      }

      res.writeHead(200, { 'Content-Type': getContentType(targetPath) });
      res.end(file);
    });
  });
};

if (import.meta.url === `file://${__filename}`) {
  loadPersistedSessions();
  runQueuedStartRequests();
  process.on('SIGTERM', () => {
    persistCatalog();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    persistCatalog();
    process.exit(0);
  });
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`ADHD setup server running at http://${HOST}:${PORT}`);
  });
}
