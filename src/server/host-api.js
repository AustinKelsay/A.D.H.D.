import { randomBytes } from "node:crypto";
import { RuntimeError } from "../runtime/errors.js";
import {
  buildDeterministicPlan,
  getConductorPromptPackage,
  normalizeIntent,
  resolveDelegationMode,
  validateStructuredPlan
} from "../intent/index.js";

const ALLOWED_DELEGATION_MODES = new Set(["multi_agent", "fallback_workers"]);

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeError(error) {
  if (error instanceof RuntimeError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details ?? null
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: error?.message || "Unexpected server error",
    details: null
  };
}

function statusForErrorCode(code) {
  if (code === "INVALID_JSON" || code === "INVALID_INPUT") {
    return 400;
  }
  if (code === "INVALID_PLAN") {
    return 422;
  }
  if (code === "JOB_NOT_FOUND") {
    return 404;
  }
  if (code === "JOB_NOT_TERMINAL" || code === "JOB_TERMINAL") {
    return 409;
  }
  if (code === "JOB_EXISTS") {
    return 409;
  }
  return 500;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new RuntimeError("INVALID_JSON", "Request body must be valid JSON");
  }
}

function pathParts(reqUrl) {
  return reqUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

function readRequestedMode(payload = {}) {
  const candidate = payload.delegationMode ?? payload.requestedMode ?? null;
  if (candidate === null || candidate === undefined) {
    return null;
  }
  if (typeof candidate !== "string") {
    throw new RuntimeError("INVALID_INPUT", "delegationMode/requestedMode must be a string");
  }

  const normalized = candidate.trim().toLowerCase();
  if (!ALLOWED_DELEGATION_MODES.has(normalized)) {
    throw new RuntimeError(
      "INVALID_INPUT",
      `delegationMode/requestedMode must be one of: ${[...ALLOWED_DELEGATION_MODES].join(", ")}`
    );
  }
  return normalized;
}

function readDelegationPolicy(payload = {}) {
  if (payload.delegationPolicy === undefined || payload.delegationPolicy === null) {
    return {};
  }
  if (typeof payload.delegationPolicy !== "object" || Array.isArray(payload.delegationPolicy)) {
    throw new RuntimeError("INVALID_INPUT", "delegationPolicy must be an object");
  }
  return payload.delegationPolicy;
}

function readHostCapabilities(payload = {}) {
  if (payload.hostCapabilities === undefined || payload.hostCapabilities === null) {
    return null;
  }
  if (typeof payload.hostCapabilities !== "object" || Array.isArray(payload.hostCapabilities)) {
    throw new RuntimeError("INVALID_INPUT", "hostCapabilities must be an object");
  }
  return payload.hostCapabilities;
}

function normalizeInputMode(mode, fallback = "text") {
  if (typeof mode !== "string") {
    return fallback;
  }
  const normalized = mode.trim().toLowerCase();
  if (normalized === "voice" || normalized === "text") {
    return normalized;
  }
  return fallback;
}

function readIntake(payload = {}, { requireText = true } = {}) {
  const intakePayload = payload.intake ?? payload.input ?? null;
  const normalizedIntake = intakePayload && typeof intakePayload === "object" && !Array.isArray(intakePayload)
    ? intakePayload
    : null;

  const mode = normalizeInputMode(
    normalizedIntake?.mode,
    normalizedIntake?.transcript ? "voice" : "text"
  );

  const textCandidate = mode === "voice"
    ? normalizedIntake?.transcript ?? normalizedIntake?.text ?? payload.inputText
    : normalizedIntake?.text ?? payload.inputText ?? normalizedIntake?.transcript;

  const inputText = typeof textCandidate === "string" ? textCandidate.trim() : "";
  if (requireText && !inputText) {
    throw new RuntimeError("INVALID_INPUT", "inputText is required and must be a string");
  }

  if (!normalizedIntake) {
    return {
      inputText: inputText || null,
      intake: inputText
        ? {
            mode,
            source: mode,
            language: null,
            segmentCount: null
          }
        : null
    };
  }

  return {
    inputText: inputText || null,
    intake: {
      mode,
      source: typeof normalizedIntake.source === "string" ? normalizedIntake.source : mode,
      language: typeof normalizedIntake.language === "string" ? normalizedIntake.language : null,
      segmentCount: Array.isArray(normalizedIntake.segments) ? normalizedIntake.segments.length : null
    }
  };
}

function mergeIntentMetadata(baseMetadata, intake) {
  if (!intake) {
    return baseMetadata || null;
  }

  const base = baseMetadata && typeof baseMetadata === "object" && !Array.isArray(baseMetadata)
    ? baseMetadata
    : {};
  return {
    ...base,
    intake
  };
}

function resolveIntent(payload = {}) {
  const intentPayload = payload.intent;
  const hasExplicitRawIntent =
    intentPayload && typeof intentPayload === "object" && !Array.isArray(intentPayload) &&
    typeof intentPayload.rawText === "string" && intentPayload.rawText.trim().length > 0;
  const intakeResult = readIntake(payload, { requireText: !hasExplicitRawIntent });

  if (intentPayload === undefined || intentPayload === null) {
    const intent = normalizeIntent({
      inputText: intakeResult.inputText,
      target: payload.target || ".",
      hostConstraints: payload.hostConstraints ?? null,
      metadata: mergeIntentMetadata(payload.metadata ?? null, intakeResult.intake)
    });
    return { intent, intake: intakeResult.intake };
  }

  if (typeof intentPayload !== "object" || Array.isArray(intentPayload)) {
    throw new RuntimeError("INVALID_INPUT", "intent must be an object");
  }

  const intent = normalizeIntent({
    inputText: intentPayload.rawText ?? intakeResult.inputText,
    target: intentPayload.target ?? payload.target ?? ".",
    hostConstraints: intentPayload.hostConstraints ?? payload.hostConstraints ?? null,
    metadata: mergeIntentMetadata(
      intentPayload.metadata ?? payload.metadata ?? null,
      intakeResult.intake
    )
  });
  return { intent, intake: intakeResult.intake };
}

function isRuntimeReady(options) {
  if (typeof options.isRuntimeReady === "function") {
    return Boolean(options.isRuntimeReady());
  }
  return true;
}

function runtimeStatus(options) {
  if (typeof options.getRuntimeStatus === "function") {
    return options.getRuntimeStatus();
  }
  return {
    ready: isRuntimeReady(options),
    error: null
  };
}

function hostCapabilities(options) {
  if (typeof options.getHostCapabilities === "function") {
    return options.getHostCapabilities();
  }
  return null;
}

function defaultDelegationPolicy(options) {
  if (typeof options.getDelegationPolicy !== "function") {
    return {};
  }

  const policy = options.getDelegationPolicy();
  if (policy === undefined || policy === null) {
    return {};
  }
  if (typeof policy !== "object" || Array.isArray(policy)) {
    throw new RuntimeError("INVALID_CONFIG", "Host default delegation policy must be an object");
  }
  return policy;
}

function parsePolicyFlag(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "on", "yes"].includes(normalized)) {
      return true;
    }
  }
  return Boolean(value);
}

function parsePolicyMode(value, fallback = "fallback_workers") {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return ALLOWED_DELEGATION_MODES.has(normalized) ? normalized : fallback;
}

function mergeDelegationPolicy(basePolicy = {}, requestPolicy = {}) {
  const baseAllow = parsePolicyFlag(basePolicy.allowMultiAgent, true);
  const baseKillSwitch = parsePolicyFlag(basePolicy.multiAgentKillSwitch, false);
  const baseDefaultMode = parsePolicyMode(basePolicy.defaultMode, "fallback_workers");

  const allowMultiAgent = baseAllow
    ? parsePolicyFlag(requestPolicy.allowMultiAgent, baseAllow)
    : false;
  const multiAgentKillSwitch = baseKillSwitch
    ? true
    : parsePolicyFlag(requestPolicy.multiAgentKillSwitch, baseKillSwitch);
  const defaultMode = parsePolicyMode(requestPolicy.defaultMode, baseDefaultMode);

  return {
    defaultMode,
    allowMultiAgent,
    multiAgentKillSwitch
  };
}

function parseCapabilityFlag(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "on", "yes"].includes(normalized)) {
      return true;
    }
  }
  return Boolean(value);
}

function mergeTrustedHostCapabilities(baseCapabilities, requestedCapabilities) {
  if (!baseCapabilities || typeof baseCapabilities !== "object") {
    return baseCapabilities || null;
  }

  const baseMultiAgent = parseCapabilityFlag(
    baseCapabilities.multi_agent ?? baseCapabilities.multiAgent,
    false
  );
  const requestedMultiAgent = parseCapabilityFlag(
    requestedCapabilities?.multi_agent ?? requestedCapabilities?.multiAgent,
    true
  );
  const effectiveMultiAgent = baseMultiAgent && requestedMultiAgent;

  return {
    ...baseCapabilities,
    multi_agent: effectiveMultiAgent,
    multiAgent: effectiveMultiAgent
  };
}

function pendingApprovals(runtime, jobId) {
  if (typeof runtime.listPendingApprovals !== "function") {
    return [];
  }
  return runtime.listPendingApprovals(jobId);
}

function enforcePlanDelegation({
  plan,
  intent,
  requestedMode,
  delegationPolicy,
  capabilities
}) {
  const enforcedDelegation = resolveDelegationMode({
    requestedMode: plan?.delegation?.requestedMode ?? requestedMode,
    profileHint: intent.profileHint,
    delegationPolicy,
    hostCapabilities: capabilities
  });

  return validateStructuredPlan(
    {
      ...plan,
      delegation: enforcedDelegation
    },
    { intent }
  );
}

function resolveIntentAndPlan(body, options) {
  const { intent, intake } = resolveIntent(body);
  const promptPackage = getConductorPromptPackage();
  const requestedMode = readRequestedMode(body);
  const delegationPolicy = mergeDelegationPolicy(
    defaultDelegationPolicy(options),
    readDelegationPolicy(body)
  );
  const baseCapabilities = hostCapabilities(options);
  const requestedCapabilities = readHostCapabilities(body);
  const capabilities = mergeTrustedHostCapabilities(baseCapabilities, requestedCapabilities);

  const plan = body.plan
    ? enforcePlanDelegation({
        plan: validateStructuredPlan(body.plan, { intent }),
        intent,
        requestedMode,
        delegationPolicy,
        capabilities
      })
    : buildDeterministicPlan(intent, {
        promptVersion: promptPackage.version,
        requestedMode,
        delegationPolicy,
        hostCapabilities: capabilities
      });

  return {
    intent,
    intake,
    plan,
    promptPackage
  };
}

export function createJobId() {
  return `j_${randomBytes(6).toString("hex")}`;
}

export function createHostApiHandler({
  runtime,
  hostId,
  isRuntimeReady: checkRuntime,
  getRuntimeStatus,
  getHostCapabilities,
  getDelegationPolicy
} = {}) {
  if (!runtime) {
    throw new RuntimeError("MISSING_RUNTIME", "createHostApiHandler requires runtime");
  }

  const options = {
    isRuntimeReady: checkRuntime,
    getRuntimeStatus,
    getHostCapabilities,
    getDelegationPolicy
  };

  return async function handler(req, res) {
    const reqUrl = new URL(req.url, "http://127.0.0.1");
    const parts = pathParts(reqUrl);

    try {
      if (req.method === "GET" && reqUrl.pathname === "/health") {
        const hostPolicy = defaultDelegationPolicy(options);
        return json(res, 200, {
          ok: true,
          hostId,
          runtime: runtimeStatus(options),
          delegationPolicy: mergeDelegationPolicy(hostPolicy, {})
        });
      }

      if (req.method === "POST" && parts.length === 3 && parts[0] === "api" && parts[1] === "intent" && parts[2] === "normalize") {
        const body = await readJsonBody(req);
        const { intent, intake } = resolveIntent(body);
        return json(res, 200, { ok: true, intake, intent });
      }

      if (req.method === "POST" && parts.length === 3 && parts[0] === "api" && parts[1] === "intent" && parts[2] === "plan") {
        const body = await readJsonBody(req);
        const { intake, intent, plan, promptPackage } = resolveIntentAndPlan(body, options);

        return json(res, 200, {
          ok: true,
          intake,
          intent,
          plan,
          prompt: {
            version: promptPackage.version,
            path: promptPackage.promptPath
          }
        });
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "jobs") {
        const body = await readJsonBody(req);
        const { intake, intent, plan, promptPackage } = resolveIntentAndPlan(body, options);

        const job = runtime.createJob({
          jobId: body.jobId || createJobId(),
          inputText: intent.rawText,
          intake,
          delegationMode: plan.delegation.selectedMode,
          policySnapshot: body.policySnapshot,
          intent,
          plan,
          delegationDecision: plan.delegation
        });

        return json(res, 201, {
          ok: true,
          job,
          prompt: {
            version: promptPackage.version,
            path: promptPackage.promptPath
          }
        });
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "intake") {
        const body = await readJsonBody(req);
        const { intake, intent, plan, promptPackage } = resolveIntentAndPlan(body, options);

        if (body.autoStart === true && !isRuntimeReady(options)) {
          return json(res, 503, {
            ok: false,
            error: {
              code: "RUNTIME_NOT_READY",
              message: "Host runtime is not ready for start operations"
            },
            runtime: runtimeStatus(options)
          });
        }

        let job = runtime.createJob({
          jobId: body.jobId || createJobId(),
          inputText: intent.rawText,
          intake,
          delegationMode: plan.delegation.selectedMode,
          policySnapshot: body.policySnapshot,
          intent,
          plan,
          delegationDecision: plan.delegation
        });

        if (body.autoStart === true) {
          job = await runtime.startJob(job.jobId, body.startParams || {});
        }

        return json(res, 201, {
          ok: true,
          intake,
          autoStarted: body.autoStart === true,
          job,
          prompt: {
            version: promptPackage.version,
            path: promptPackage.promptPath
          }
        });
      }

      if (req.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "jobs") {
        return json(res, 200, {
          ok: true,
          jobs: runtime.listJobs()
        });
      }

      if (req.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "jobs") {
        const job = runtime.getJob(parts[2]);
        if (!job) {
          return json(res, 404, {
            ok: false,
            error: {
              code: "JOB_NOT_FOUND",
              message: `Job not found: ${parts[2]}`
            }
          });
        }

        return json(res, 200, { ok: true, job });
      }

      if (req.method === "GET" && parts.length === 4 && parts[0] === "api" && parts[1] === "jobs" && parts[3] === "live") {
        const job = runtime.getJob(parts[2]);
        if (!job) {
          return json(res, 404, {
            ok: false,
            error: {
              code: "JOB_NOT_FOUND",
              message: `Job not found: ${parts[2]}`
            }
          });
        }

        return json(res, 200, {
          ok: true,
          job,
          pendingApprovals: pendingApprovals(runtime, parts[2])
        });
      }

      if (req.method === "GET" && parts.length === 4 && parts[0] === "api" && parts[1] === "jobs" && parts[3] === "result") {
        const result = typeof runtime.getJobResult === "function"
          ? runtime.getJobResult(parts[2])
          : (() => {
              const job = runtime.getJob(parts[2]);
              if (!job) {
                return null;
              }
              return {
                resultSummary: job.resultSummary ?? null,
                artifactPaths: Array.isArray(job.artifactPaths) ? job.artifactPaths : []
              };
            })();

        if (!result) {
          return json(res, 404, {
            ok: false,
            error: {
              code: "JOB_NOT_FOUND",
              message: `Job not found: ${parts[2]}`
            }
          });
        }

        return json(res, 200, {
          ok: true,
          jobId: parts[2],
          result
        });
      }

      if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "jobs" && parts[3] === "start") {
        if (!isRuntimeReady(options)) {
          return json(res, 503, {
            ok: false,
            error: {
              code: "RUNTIME_NOT_READY",
              message: "Host runtime is not ready for start operations"
            },
            runtime: runtimeStatus(options)
          });
        }

        const body = await readJsonBody(req);
        const job = await runtime.startJob(parts[2], body);
        return json(res, 200, { ok: true, job });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "jobs" &&
        parts[3] === "retry"
      ) {
        const body = await readJsonBody(req);
        if (body.startNow === true && !isRuntimeReady(options)) {
          return json(res, 503, {
            ok: false,
            error: {
              code: "RUNTIME_NOT_READY",
              message: "Host runtime is not ready for retry+start operations"
            },
            runtime: runtimeStatus(options)
          });
        }

        let job = await runtime.retryJob(parts[2]);
        if (body.startNow === true) {
          job = await runtime.startJob(parts[2], body.startParams || {});
        }

        return json(res, 200, {
          ok: true,
          autoStarted: body.startNow === true,
          job
        });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "jobs" &&
        parts[3] === "interrupt"
      ) {
        if (!isRuntimeReady(options)) {
          return json(res, 503, {
            ok: false,
            error: {
              code: "RUNTIME_NOT_READY",
              message: "Host runtime is not ready for interrupt operations"
            },
            runtime: runtimeStatus(options)
          });
        }

        const job = await runtime.interruptJob(parts[2]);
        return json(res, 200, { ok: true, job });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "approvals" &&
        parts[3] === "approve"
      ) {
        const body = await readJsonBody(req);
        const requestId = Number(parts[2]);
        runtime.approveRequest(requestId, body.result || { approved: true });
        return json(res, 202, { ok: true, requestId, decision: "approved" });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "approvals" &&
        parts[3] === "reject"
      ) {
        const body = await readJsonBody(req);
        const requestId = Number(parts[2]);
        runtime.rejectRequest(requestId, body.message || "Request rejected");
        return json(res, 202, { ok: true, requestId, decision: "rejected" });
      }

      return json(res, 404, {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `No route for ${req.method} ${reqUrl.pathname}`
        }
      });
    } catch (error) {
      const normalized = normalizeError(error);
      const status = statusForErrorCode(normalized.code);
      return json(res, status, {
        ok: false,
        error: normalized
      });
    }
  };
}
