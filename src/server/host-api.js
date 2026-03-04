import { randomBytes } from "node:crypto";
import { RuntimeError } from "../runtime/errors.js";
import {
  buildDeterministicPlan,
  getConductorPromptPackage,
  normalizeIntent,
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

function resolveIntent(payload = {}) {
  const intentPayload = payload.intent;
  if (intentPayload === undefined || intentPayload === null) {
    return normalizeIntent({
      inputText: payload.inputText,
      target: payload.target || ".",
      hostConstraints: payload.hostConstraints ?? null,
      metadata: payload.metadata ?? null
    });
  }

  if (typeof intentPayload !== "object" || Array.isArray(intentPayload)) {
    throw new RuntimeError("INVALID_INPUT", "intent must be an object");
  }

  return normalizeIntent({
    inputText: intentPayload.rawText ?? payload.inputText,
    target: intentPayload.target ?? payload.target ?? ".",
    hostConstraints: intentPayload.hostConstraints ?? payload.hostConstraints ?? null,
    metadata: intentPayload.metadata ?? payload.metadata ?? null
  });
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

export function createJobId() {
  return `j_${randomBytes(6).toString("hex")}`;
}

export function createHostApiHandler({
  runtime,
  hostId,
  isRuntimeReady: checkRuntime,
  getRuntimeStatus,
  getHostCapabilities
} = {}) {
  if (!runtime) {
    throw new RuntimeError("MISSING_RUNTIME", "createHostApiHandler requires runtime");
  }

  const options = {
    isRuntimeReady: checkRuntime,
    getRuntimeStatus,
    getHostCapabilities
  };

  return async function handler(req, res) {
    const reqUrl = new URL(req.url, "http://127.0.0.1");
    const parts = pathParts(reqUrl);

    try {
      if (req.method === "GET" && reqUrl.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          hostId,
          runtime: runtimeStatus(options)
        });
      }

      if (req.method === "POST" && parts.length === 3 && parts[0] === "api" && parts[1] === "intent" && parts[2] === "normalize") {
        const body = await readJsonBody(req);
        const intent = resolveIntent(body);
        return json(res, 200, { ok: true, intent });
      }

      if (req.method === "POST" && parts.length === 3 && parts[0] === "api" && parts[1] === "intent" && parts[2] === "plan") {
        const body = await readJsonBody(req);
        const intent = resolveIntent(body);
        const promptPackage = getConductorPromptPackage();
        const requestedMode = readRequestedMode(body);
        const delegationPolicy = readDelegationPolicy(body);
        const capabilities = readHostCapabilities(body) || hostCapabilities(options);

        const plan = body.plan
          ? validateStructuredPlan(body.plan, { intent })
          : buildDeterministicPlan(intent, {
              promptVersion: promptPackage.version,
              requestedMode,
              delegationPolicy,
              hostCapabilities: capabilities
            });

        return json(res, 200, {
          ok: true,
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
        const intent = resolveIntent(body);
        const promptPackage = getConductorPromptPackage();
        const requestedMode = readRequestedMode(body);
        const delegationPolicy = readDelegationPolicy(body);
        const capabilities = readHostCapabilities(body) || hostCapabilities(options);

        const plan = body.plan
          ? validateStructuredPlan(body.plan, { intent })
          : buildDeterministicPlan(intent, {
              promptVersion: promptPackage.version,
              requestedMode,
              delegationPolicy,
              hostCapabilities: capabilities
            });

        const job = runtime.createJob({
          jobId: body.jobId || createJobId(),
          inputText: intent.rawText,
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
