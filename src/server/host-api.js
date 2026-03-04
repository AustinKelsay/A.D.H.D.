import { randomBytes } from "node:crypto";
import { RuntimeError } from "../runtime/errors.js";

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

export function createJobId() {
  return `j_${randomBytes(6).toString("hex")}`;
}

export function createHostApiHandler({ runtime, hostId, isRuntimeReady: checkRuntime, getRuntimeStatus } = {}) {
  if (!runtime) {
    throw new RuntimeError("MISSING_RUNTIME", "createHostApiHandler requires runtime");
  }

  const options = {
    isRuntimeReady: checkRuntime,
    getRuntimeStatus
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

      if (req.method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "jobs") {
        const body = await readJsonBody(req);
        const inputText = body.inputText;
        if (!inputText || typeof inputText !== "string") {
          throw new RuntimeError("INVALID_INPUT", "inputText is required and must be a string");
        }

        const job = runtime.createJob({
          jobId: body.jobId || createJobId(),
          inputText,
          delegationMode: body.delegationMode || "fallback_workers",
          policySnapshot: body.policySnapshot
        });

        return json(res, 201, { ok: true, job });
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
