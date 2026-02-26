import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  normalizeOpenAIBaseUrl,
  normalizeText,
  resolveOrchestratorConfig,
} from './lib/orchestrator-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_OUTPUT_CHARS = 16000;
const MAX_BODY_SIZE = Number(process.env.ADHD_MAX_BODY_SIZE_BYTES || 1024 * 1024);
const DEFAULT_TIMEOUT_MS = Number(process.env.ADHD_SESSION_TIMEOUT_MS || 120000);
const ORCHESTRATOR_TIMEOUT_MS = Number(process.env.ADHD_ORCHESTRATOR_TIMEOUT_MS || 15000);
const API_TOKEN = process.env.ADHD_API_TOKEN || '';
const API_AUTH_HEADER = 'x-adhd-api-token';
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
const ORCHESTRATOR_PLAN_DECISION = {
  autoRun: 'autoRun',
  requiresConfirmation: 'requiresConfirmation',
};
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

const PROFILE_RUNTIME_TEMPLATES = {
  basic: {
    command: process.env.ADHD_CODEX_COMMAND || 'codex',
    args: (process.env.ADHD_CODEX_HELP_ARGS || '--help').trim().split(/\s+/).filter(Boolean),
    taskArgToken: process.env.ADHD_CODEX_TASK_ARG || '',
  },
  edit: {
    command: process.env.ADHD_CODEX_COMMAND || 'codex',
    args: (process.env.ADHD_CODEX_HELP_ARGS || '--help').trim().split(/\s+/).filter(Boolean),
    taskArgToken: process.env.ADHD_CODEX_TASK_ARG || '',
  },
  git: {
    command: process.env.ADHD_CODEX_COMMAND || 'codex',
    args: (process.env.ADHD_CODEX_HELP_ARGS || '--help').trim().split(/\s+/).filter(Boolean),
    taskArgToken: process.env.ADHD_CODEX_TASK_ARG || '',
  },
  release: {
    command: process.env.ADHD_CODEX_COMMAND || 'codex',
    args: (process.env.ADHD_CODEX_HELP_ARGS || '--help').trim().split(/\s+/).filter(Boolean),
    taskArgToken: process.env.ADHD_CODEX_TASK_ARG || '',
  },
};

const CODEX_TASK_PLACEHOLDER = '{{task}}';

const sessionCatalog = new Map();

const runtimeDefaults = {
  profile: 'basic',
  workingDirectory: process.env.HOME || process.cwd(),
  state: DEFAULT_STATE,
};

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

function resolvePlanDecision(profile, confidence, requestedConfirmation = false) {
  const threshold = ORCHESTRATOR_PLAN_THRESHOLD[profile] ?? 0.9;
  if (profile === 'release') {
    return ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
  }

  if (requestedConfirmation) return ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
  if (confidence >= threshold) return ORCHESTRATOR_PLAN_DECISION.autoRun;
  return ORCHESTRATOR_PLAN_DECISION.requiresConfirmation;
}

function stripCodeFences(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function extractPlanFromResponse(payload) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  const messageContent = firstChoice?.message?.content;
  const directContent = firstChoice?.message?.content || payload?.content;
  const raw = stripCodeFences(messageContent || directContent || '');
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function runOrchestratorPlan(session) {
  const startAt = Date.now();
  const config = resolveOrchestratorConfig();
  if (config.invalid) {
    throw Object.assign(new Error('Orchestrator configuration is invalid: missing base URL'), {
      category: 'orchestrator-unavailable',
      provider: config.provider,
    });
  }
  const requestPayload = {
    model: config.model,
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

  const requestHeaders = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    requestHeaders.Authorization = `Bearer ${config.apiKey}`;
  }

  const endpoint = `${normalizeOpenAIBaseUrl(config.baseUrl)}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORCHESTRATOR_TIMEOUT_MS);

  let rawResponse;
  try {
    rawResponse = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });
  } catch (error) {
    throw Object.assign(new Error(`Orchestrator call failed: ${error.message}`), {
      category: 'orchestrator-unavailable',
      provider: config.provider,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!rawResponse.ok) {
    const bodyText = await rawResponse.text().catch(() => 'unknown-body');
    throw Object.assign(new Error(`Orchestrator returned ${rawResponse.status}: ${bodyText}`), {
      category: 'orchestrator-unavailable',
      provider: config.provider,
    });
  }

  const body = await rawResponse.json();
  const candidate = extractPlanFromResponse(body);
  if (!candidate) {
    throw Object.assign(new Error('Orchestrator response was not valid JSON object'), {
      category: 'orchestrator-invalid-plan',
      provider: config.provider,
    });
  }

  const selectedProfile = normalizeProfile(candidate.profile || candidate.selectedProfile || candidate.recommendedProfile || session.profile);
  const confidence = parseConfidence(candidate.confidence);
  if (selectedProfile == null) {
    throw Object.assign(new Error('Orchestrator profile is missing or invalid'), {
      category: 'orchestrator-invalid-plan',
      provider: config.provider,
    });
  }
  if (confidence === null) {
    throw Object.assign(new Error('Orchestrator confidence is missing or invalid'), {
      category: 'orchestrator-invalid-plan',
      provider: config.provider,
    });
  }

  const requiresConfirmation = normalizeBoolean(
    candidate.requiresConfirmation ?? candidate.requires_confirmation,
  );
  const decision = resolvePlanDecision(selectedProfile, confidence, requiresConfirmation);
  const latencyMs = Date.now() - startAt;
  const reason = normalizeText(candidate.reason || candidate.summary || 'No reason provided');
  const suggestedArgs = normalizeArgs(candidate.args || candidate.suggestedArgs || candidate.commandArgs);

  return {
    provider: config.provider,
    model: config.model,
    traceId: body.id || null,
    selectedProfile,
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

function makeSessionId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

  if (!API_TOKEN) {
    return {
      ok: false,
      statusCode: 403,
      error: 'API token required for non-local API access.',
    };
  }

  const presentedToken = extractApiToken(req);
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
}

function trimTask(text) {
  return normalizeText(text || '');
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
  const profile = normalizeProfile(payload.profile);
  if (!profile) {
    return {
      ok: false,
      error: `Invalid profile. Expected one of: ${Array.from(SESSION_PROFILES).join(', ')}`,
    };
  }

  const workingDirectory = normalizeWorkingDirectory(payload.workingDirectory);
  const rawTask = trimTask(payload.taskText || payload.task || '');
  const normalizedTask = trimTask(rawTask);

  const profileTemplate = PROFILE_RUNTIME_TEMPLATES[profile];
  const startupArgs = normalizeArgs(payload.startupArgs || payload.args || payload.commandArgs);
  const runtimeArgs = startupArgs || profileTemplate.args.slice();
  const runtimeTaskArgToken = payload.taskArgToken ?? profileTemplate.taskArgToken;
  const command = normalizeText(profileTemplate.command || 'codex');

  const session = {
    sessionId: payload.sessionId || makeSessionId(),
    profile,
    workingDirectory,
    state: runtimeDefaults.state,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    task: normalizedTask,
    taskIntent: {
      rawText: rawTask,
      normalizedText: normalizedTask,
      source: payload.source || 'setup-stub',
    },
    profileHint: payload.profileHint || null,
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
      process: null,
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

  return session;
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

function listSessions() {
  return [...sessionCatalog.values()].map(scrubSessionForTransport);
}

function getSession(sessionId) {
  const session = sessionCatalog.get(sessionId);
  if (!session) return null;
  return scrubSessionForTransport(session);
}

function createSession(sessionInput) {
  const hydrated = hydrateSessionPayload(sessionInput);
  if (!hydrated.ok) return hydrated;

  const validationError = validateSession(hydrated.session);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  sessionCatalog.set(hydrated.session.sessionId, hydrated.session);
  return { ok: true, session: hydrated.session };
}

function resolveRunnerArgs(session, options) {
  const template = PROFILE_RUNTIME_TEMPLATES[session.profile];
  const source = options || {};
  const rawArgs = normalizeArgs(source.args || source.commandArgs || source.commandArguments || session.runtime.args);
  const taskArgToken = source.taskArgToken || session.runtime.taskArgToken;
  const baseArgs = rawArgs ? rawArgs.slice() : (template.args ? template.args.slice() : []);
  const withTaskTemplate = resolveArgTemplateTokens(baseArgs, session.task);

  if (!taskArgToken || !session.task) return withTaskTemplate;

  if (baseArgs.includes(CODEX_TASK_PLACEHOLDER)) return withTaskTemplate;
  return withTaskTemplate.concat([taskArgToken, session.task]);
}

function buildRunnerInvocation(session, options = {}) {
  const source = options || {};
  const command = normalizeText(source.command || session.runtime.command || PROFILE_RUNTIME_TEMPLATES[session.profile].command);

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
  const template = PROFILE_RUNTIME_TEMPLATES[plan.selectedProfile];
  const runtimeArgs = Array.isArray(plan.suggestedArgs) && plan.suggestedArgs.length
    ? plan.suggestedArgs.slice()
    : session.runtime.args.slice();

  session.profile = plan.selectedProfile;
  session.runtime.args = runtimeArgs;
  session.runtime.taskArgToken = template.taskArgToken;
  session.runtime.command = template.command || session.runtime.command;
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
}

function startSessionError(status, error, session, requiresConfirmation = false, planDecision = null) {
  return {
    ok: false,
    status,
    error,
    requiresConfirmation,
    planDecision,
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

  session.runtime.process = null;
  clearTimeoutHandle(session);
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

async function runCodexRunner(session, options = {}) {
  const invocation = buildRunnerInvocation(session, options);
  let processObj;

  try {
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
    session.runtime.startedAt = nowIso();
  } catch (error) {
    finalizeSessionTerminal(session, 'failed', 'spawn-error', {
      exitCode: -1,
      error: error.message,
    });
    return;
  }

  if (session.state !== 'starting') {
    terminateProcess(session);
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
    finalizeSessionTerminal(session, 'failed', 'runner-error');
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

    session.runtime.stopRequested = true;
    session.runtime.error = `Timeout after ${session.runtime.timeoutMs}ms`;
    session.runtime.timeoutHandle = null;
    terminateProcess(session);
    finalizeSessionTerminal(session, 'failed', 'runner-timeout', {
      exitCode: null,
      error: `Timeout after ${session.runtime.timeoutMs}ms`,
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
    return startSessionError(409, session.runtime.error, session, false, null);
  }

  session.runtime.stopRequested = false;
  session.runtime.error = null;
  session.runtime.exitCode = null;
  session.runtime.signal = null;

  const confirm = normalizeBoolean(options.confirm);
  let plan;

  try {
    plan = await runOrchestratorPlan(session);
    if (!canStartFromState(session)) {
      session.runtime.error = `Cannot start from state: ${session.state}`;
      return startSessionError(409, session.runtime.error, session);
    }

    applyOrchestratorPlan(session, plan);
  } catch (error) {
    const config = resolveOrchestratorConfig();
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
      category: error.category || 'orchestrator-unavailable',
      error: error.message,
      planAt: nowIso(),
    };
    session.runtime.error = `Orchestrator failed: ${error.message}`;
    finalizeSessionTerminal(session, 'failed', 'planner-failed');
    return startSessionError(
      500,
      `Orchestrator failed: ${error.message}`,
      session,
      false,
      ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
    );
  }

  if (plan.decision === ORCHESTRATOR_PLAN_DECISION.requiresConfirmation && !confirm) {
    session.runtime.error = 'Execution requires confirmation from caller.';
    if (session.state !== 'awaiting_confirmation') {
      if (!canTransition(session.state, 'awaiting_confirmation')) {
        session.runtime.error = `Cannot transition session from ${session.state} to awaiting_confirmation`;
        return startSessionError(
          409,
          session.runtime.error,
          session,
          true,
          ORCHESTRATOR_PLAN_DECISION.requiresConfirmation,
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
    );
  }

  if (session.state !== 'starting') {
    if (!canTransition(session.state, 'starting')) {
      return startSessionError(
        409,
        `Cannot transition session from ${session.state} to starting`,
        session,
        false,
        ORCHESTRATOR_PLAN_DECISION.autoRun,
      );
    }
    transitionSession(session, 'starting', 'planner-approved');
  }

  runCodexRunner(session, {
    args: plan.suggestedArgs || options.args || options.commandArgs || session.runtime.args,
    timeoutMs: options.timeoutMs,
    env: normalizeObject(options.env),
  }).catch((error) => {
    finalizeSessionTerminal(session, 'failed', 'runner-unhandled-error', {
      exitCode: -1,
      error: `Runner failed: ${error.message}`,
    });
  });

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
  transitionSession(session, 'cancelled', 'user-stop-request');
  return { ok: true, session: getSession(sessionId) };
}

function handleApiRequest(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = url.pathname;
  const parts = pathname.split('/').filter(Boolean);

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
          emitResponse(res, 400, { ok: false, error: result.error, phase: 'session-runtime' });
          return;
        }

        const created = createSession(result.session);
        if (!created.ok) {
          emitResponse(res, 400, { ok: false, error: created.error, phase: 'session-runtime' });
          return;
        }

        emitResponse(res, 201, { ok: true, session: getSession(created.session.sessionId) });
      })
      .catch((error) => {
        const parsed = collectBodyRequestError(error);
        emitResponse(res, parsed.statusCode, { ok: false, error: parsed.message });
      });
  }

  if (parts[0] !== 'api' || parts[1] !== 'sessions') {
    emitResponse(res, 404, { ok: false, error: 'Unknown endpoint' });
    return;
  }

  if (req.method === 'GET' && parts.length === 2) {
    emitResponse(res, 200, { ok: true, sessions: listSessions() });
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
            emitResponse(res, result.status || 400, errorResponse);
            return;
          }
          emitResponse(res, 200, { ok: true, session: result.session });
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

    if (action === 'stop') {
      const result = stopSession(sessionId);
      if (!result.ok) {
        emitResponse(res, result.status || 400, { ok: false, error: result.error });
        return;
      }

      emitResponse(res, 200, { ok: true, session: result.session });
      return;
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
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`ADHD setup server running at http://${HOST}:${PORT}`);
  });
}
