import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { RuntimeError } from "../runtime/errors.js";
import { createHostApiHandler } from "./host-api.js";

const HOST_ID_PATTERN = /^h_[a-z0-9]{6,}$/;
const NON_TERMINAL_STATES = new Set([
  "draft",
  "queued",
  "dispatching",
  "planning",
  "awaiting_approval",
  "delegating",
  "running",
  "summarizing"
]);

function nowIso() {
  return new Date().toISOString();
}

function defaultCapabilities() {
  return {
    codexVersion: "unknown",
    appServer: false,
    mcp: false,
    mcpServer: false,
    features: {
      multi_agent: null
    }
  };
}

function normalizeCompatibility(input) {
  const base = {
    status: "unknown",
    checkedAt: nowIso(),
    missingMethods: []
  };

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }

  const status = typeof input.status === "string" ? input.status : "unknown";
  const checkedAt = typeof input.checkedAt === "string" ? input.checkedAt : nowIso();
  const missingMethods = Array.isArray(input.missingMethods)
    ? input.missingMethods.filter((entry) => typeof entry === "string")
    : [];

  return {
    status: ["unknown", "compatible", "incompatible"].includes(status) ? status : "unknown",
    checkedAt,
    missingMethods
  };
}

function normalizeCapabilities(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return defaultCapabilities();
  }

  const features = input.features && typeof input.features === "object" && !Array.isArray(input.features)
    ? input.features
    : {};
  const multiAgent = features.multi_agent && typeof features.multi_agent === "object" && !Array.isArray(features.multi_agent)
    ? {
        stage: typeof features.multi_agent.stage === "string" ? features.multi_agent.stage : "unknown",
        enabled: Boolean(features.multi_agent.enabled)
      }
    : null;

  return {
    codexVersion: typeof input.codexVersion === "string" ? input.codexVersion : "unknown",
    appServer: Boolean(input.appServer),
    mcp: Boolean(input.mcp),
    mcpServer: Boolean(input.mcpServer),
    features: {
      multi_agent: multiAgent
    }
  };
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
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

function parseBearerToken(authHeader = "") {
  if (typeof authHeader !== "string") {
    return null;
  }

  const trimmed = authHeader.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }
  return parts[1];
}

function pathParts(reqUrl) {
  return reqUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

async function invokeHandler(handler, { method, url, body = null, headers = {} }) {
  const chunks = [];
  if (body !== null) {
    chunks.push(Buffer.from(body, "utf8"));
  }

  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = headers;

  let ended = false;
  let responseBody = "";
  const responseHeaders = {};
  let responseStatusCode = 200;

  const done = new Promise((resolve) => {
    const res = {
      get statusCode() {
        return responseStatusCode;
      },
      set statusCode(value) {
        responseStatusCode = value;
      },
      setHeader(name, value) {
        responseHeaders[String(name).toLowerCase()] = value;
      },
      end(data = "") {
        if (ended) {
          return;
        }
        ended = true;
        responseBody += Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        resolve();
      }
    };

    Promise.resolve(handler(req, res)).then(() => {
      if (!ended) {
        res.end();
      }
    });
  });

  await done;

  let jsonBody = null;
  if (responseBody.trim()) {
    jsonBody = JSON.parse(responseBody);
  }

  return {
    statusCode: responseStatusCode,
    headers: responseHeaders,
    body: responseBody,
    json: jsonBody
  };
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
  if (code === "HOST_NOT_FOUND" || code === "JOB_NOT_FOUND") {
    return 404;
  }
  if (code === "HOST_NOT_READY" || code === "HOST_UNAUTHORIZED") {
    return 401;
  }
  if (code === "HOST_REVOKED" || code === "HOST_NOT_ENROLLED") {
    return 409;
  }
  if (code === "HOST_OFFLINE") {
    return 503;
  }
  if (code === "INVALID_PLAN") {
    return 422;
  }
  return 500;
}

function ensureHostId(hostId) {
  if (typeof hostId !== "string" || !HOST_ID_PATTERN.test(hostId)) {
    throw new RuntimeError("INVALID_INPUT", "hostId must match ^h_[a-z0-9]{6,}$");
  }
}

function createHostRecord({ hostId, displayName = null } = {}) {
  const createdAt = nowIso();
  return {
    hostId,
    displayName: displayName || hostId,
    auth: {
      status: "pending",
      tokenId: null
    },
    heartbeat: {
      status: "offline",
      lastSeenAt: createdAt
    },
    capabilities: defaultCapabilities(),
    compatibility: {
      status: "unknown",
      checkedAt: createdAt,
      missingMethods: []
    },
    createdAt,
    updatedAt: createdAt
  };
}

function sanitizeHostRecord(record) {
  return structuredClone(record);
}

export function createFederationApiHandler({
  hosts = {},
  heartbeatDegradedMs = 15000,
  heartbeatOfflineMs = 30000
} = {}) {
  const hostRecords = new Map();
  const enrollmentTokens = new Map();
  const hostSessionTokens = new Map();
  const jobRoutes = new Map();

  const hostHandlers = new Map();
  const configuredHosts = new Set(Object.keys(hosts));
  for (const [hostId, config] of Object.entries(hosts)) {
    ensureHostId(hostId);
    if (!config || typeof config !== "object" || !config.runtime) {
      throw new RuntimeError("INVALID_CONFIG", `Host config must include runtime for ${hostId}`);
    }
    hostHandlers.set(hostId, createHostApiHandler({
      runtime: config.runtime,
      hostId,
      isRuntimeReady: config.isRuntimeReady,
      getRuntimeStatus: config.getRuntimeStatus,
      getHostCapabilities: config.getHostCapabilities,
      getDelegationPolicy: config.getDelegationPolicy,
      getMobileConfig: config.getMobileConfig
    }));
  }

  const refreshHostHeartbeat = (record, nowMs = Date.now()) => {
    if (record.auth.status !== "enrolled") {
      record.heartbeat.status = "offline";
      return;
    }

    const lastSeenMs = Date.parse(record.heartbeat.lastSeenAt);
    const age = Number.isFinite(lastSeenMs) ? nowMs - lastSeenMs : Number.MAX_SAFE_INTEGER;
    if (age >= heartbeatOfflineMs) {
      record.heartbeat.status = "offline";
    } else if (age >= heartbeatDegradedMs) {
      record.heartbeat.status = "degraded";
    } else {
      record.heartbeat.status = "online";
    }
  };

  const requireHostRecord = (hostId) => {
    const record = hostRecords.get(hostId);
    if (!record) {
      throw new RuntimeError("HOST_NOT_FOUND", `Host not found: ${hostId}`);
    }
    return record;
  };

  const requireHostAvailableForDispatch = (hostId) => {
    const record = requireHostRecord(hostId);
    refreshHostHeartbeat(record);
    if (record.auth.status === "revoked") {
      throw new RuntimeError("HOST_REVOKED", `Host is revoked: ${hostId}`);
    }
    if (record.auth.status !== "enrolled") {
      throw new RuntimeError("HOST_NOT_ENROLLED", `Host is not enrolled: ${hostId}`);
    }
    if (record.heartbeat.status !== "online") {
      throw new RuntimeError("HOST_OFFLINE", `Host is not online: ${hostId}`, {
        heartbeat: record.heartbeat.status
      });
    }
    if (!hostHandlers.has(hostId)) {
      throw new RuntimeError("HOST_NOT_READY", `No runtime bound for host: ${hostId}`);
    }
    return record;
  };

  const resolveHostForJob = async (jobId) => {
    const routed = jobRoutes.get(jobId);
    if (routed) {
      return routed;
    }

    for (const [hostId, handler] of hostHandlers.entries()) {
      const response = await invokeHandler(handler, {
        method: "GET",
        url: `/api/jobs/${encodeURIComponent(jobId)}`
      });
      if (response.statusCode === 200 && response.json?.job?.jobId === jobId) {
        jobRoutes.set(jobId, hostId);
        return hostId;
      }
    }

    throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
  };

  return async function handler(req, res) {
    const reqUrl = new URL(req.url, "http://127.0.0.1");
    const parts = pathParts(reqUrl);

    try {
      if (req.method === "GET" && reqUrl.pathname === "/health") {
        for (const record of hostRecords.values()) {
          refreshHostHeartbeat(record);
        }
        return json(res, 200, {
          ok: true,
          controlPlane: true,
          hosts: {
            total: hostRecords.size,
            enrolled: [...hostRecords.values()].filter((record) => record.auth.status === "enrolled").length,
            online: [...hostRecords.values()].filter((record) => record.heartbeat.status === "online").length
          }
        });
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/hosts/register") {
        const body = await readJsonBody(req);
        ensureHostId(body.hostId);
        const hostId = body.hostId;
        const displayName = typeof body.displayName === "string" ? body.displayName.trim() || null : null;

        let record = hostRecords.get(hostId);
        if (!record) {
          record = createHostRecord({ hostId, displayName });
          hostRecords.set(hostId, record);
        } else if (displayName) {
          record.displayName = displayName;
          record.updatedAt = nowIso();
        }

        const enrollmentToken = `enr_${randomBytes(16).toString("hex")}`;
        enrollmentTokens.set(hostId, enrollmentToken);
        record.auth.status = "pending";
        record.auth.tokenId = `tok_${randomBytes(6).toString("hex")}`;
        record.updatedAt = nowIso();
        refreshHostHeartbeat(record);

        return json(res, 201, {
          ok: true,
          host: sanitizeHostRecord(record),
          enrollmentToken,
          configuredRuntime: configuredHosts.has(hostId)
        });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "hosts" &&
        parts[3] === "enroll"
      ) {
        const hostId = parts[2];
        const body = await readJsonBody(req);
        const record = requireHostRecord(hostId);

        const expectedToken = enrollmentTokens.get(hostId);
        if (!expectedToken || body.enrollmentToken !== expectedToken) {
          throw new RuntimeError("HOST_UNAUTHORIZED", "Invalid enrollment token");
        }

        record.auth.status = "enrolled";
        record.auth.tokenId = `tok_${randomBytes(6).toString("hex")}`;
        record.capabilities = normalizeCapabilities(body.capabilities);
        record.compatibility = normalizeCompatibility(body.compatibility);
        record.updatedAt = nowIso();
        refreshHostHeartbeat(record);

        const hostToken = `hst_${randomBytes(20).toString("hex")}`;
        hostSessionTokens.set(hostId, hostToken);
        enrollmentTokens.delete(hostId);

        return json(res, 200, {
          ok: true,
          host: sanitizeHostRecord(record),
          hostToken
        });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "hosts" &&
        parts[3] === "heartbeat"
      ) {
        const hostId = parts[2];
        const body = await readJsonBody(req);
        const record = requireHostRecord(hostId);

        if (record.auth.status !== "enrolled") {
          throw new RuntimeError("HOST_NOT_ENROLLED", `Host is not enrolled: ${hostId}`);
        }

        const tokenFromHeader = parseBearerToken(req.headers.authorization || "");
        const suppliedToken = tokenFromHeader || body.hostToken || null;
        const expected = hostSessionTokens.get(hostId);
        if (!expected || suppliedToken !== expected) {
          throw new RuntimeError("HOST_UNAUTHORIZED", "Invalid host token for heartbeat");
        }

        record.heartbeat.lastSeenAt = nowIso();
        record.heartbeat.status = "online";
        record.updatedAt = nowIso();

        if (body.capabilities !== undefined) {
          record.capabilities = normalizeCapabilities(body.capabilities);
        }
        if (body.compatibility !== undefined) {
          record.compatibility = normalizeCompatibility(body.compatibility);
        }

        refreshHostHeartbeat(record);

        return json(res, 202, {
          ok: true,
          host: sanitizeHostRecord(record)
        });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "hosts" &&
        parts[3] === "revoke"
      ) {
        const hostId = parts[2];
        const record = requireHostRecord(hostId);
        record.auth.status = "revoked";
        record.auth.tokenId = null;
        record.heartbeat.status = "offline";
        record.updatedAt = nowIso();
        enrollmentTokens.delete(hostId);
        hostSessionTokens.delete(hostId);

        return json(res, 202, {
          ok: true,
          host: sanitizeHostRecord(record)
        });
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/hosts") {
        const records = [...hostRecords.values()];
        for (const record of records) {
          refreshHostHeartbeat(record);
        }
        return json(res, 200, {
          ok: true,
          hosts: records
            .map((record) => sanitizeHostRecord(record))
            .sort((a, b) => a.hostId.localeCompare(b.hostId))
        });
      }

      if (req.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "hosts") {
        const hostId = parts[2];
        const record = requireHostRecord(hostId);
        refreshHostHeartbeat(record);
        return json(res, 200, {
          ok: true,
          host: sanitizeHostRecord(record)
        });
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/jobs") {
        const body = await readJsonBody(req);
        ensureHostId(body.hostId);
        const targetHostId = body.hostId;
        requireHostAvailableForDispatch(targetHostId);

        const payload = { ...body };
        delete payload.hostId;
        const response = await invokeHandler(hostHandlers.get(targetHostId), {
          method: "POST",
          url: "/api/intake",
          body: JSON.stringify(payload)
        });

        if (response.statusCode >= 400) {
          return json(res, response.statusCode, response.json || { ok: false });
        }

        const job = response.json?.job || null;
        if (job?.jobId) {
          jobRoutes.set(job.jobId, targetHostId);
        }

        return json(res, 201, {
          ok: true,
          hostId: targetHostId,
          ...response.json
        });
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/jobs") {
        const queryHostId = reqUrl.searchParams.get("hostId");
        const targetHostIds = queryHostId ? [queryHostId] : [...hostHandlers.keys()];
        const jobs = [];

        for (const hostId of targetHostIds) {
          if (!hostHandlers.has(hostId)) {
            continue;
          }

          const response = await invokeHandler(hostHandlers.get(hostId), {
            method: "GET",
            url: `/api/jobs${reqUrl.search}`
          });
          if (response.statusCode !== 200 || !Array.isArray(response.json?.jobs)) {
            continue;
          }

          for (const job of response.json.jobs) {
            jobs.push(job);
            if (job?.jobId) {
              jobRoutes.set(job.jobId, hostId);
            }
          }
        }

        return json(res, 200, {
          ok: true,
          jobs
        });
      }

      if (req.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "jobs") {
        const jobId = parts[2];
        const hostId = await resolveHostForJob(jobId);
        const response = await invokeHandler(hostHandlers.get(hostId), {
          method: "GET",
          url: `/api/jobs/${encodeURIComponent(jobId)}`
        });
        return json(res, response.statusCode, {
          hostId,
          ...(response.json || { ok: false })
        });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "jobs" &&
        ["start", "interrupt", "retry"].includes(parts[3])
      ) {
        const jobId = parts[2];
        const action = parts[3];
        const body = await readJsonBody(req);
        const hostId = await resolveHostForJob(jobId);

        const hostRecord = requireHostRecord(hostId);
        refreshHostHeartbeat(hostRecord);
        if (hostRecord.heartbeat.status !== "online") {
          // Deterministic outage handling: mutating actions are blocked while host is offline/degraded.
          throw new RuntimeError("HOST_OFFLINE", `Cannot ${action} while host is ${hostRecord.heartbeat.status}`, {
            hostId,
            heartbeat: hostRecord.heartbeat.status
          });
        }

        const response = await invokeHandler(hostHandlers.get(hostId), {
          method: "POST",
          url: `/api/jobs/${encodeURIComponent(jobId)}/${action}`,
          body: JSON.stringify(body || {})
        });
        return json(res, response.statusCode, {
          hostId,
          ...(response.json || { ok: false })
        });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "approvals" &&
        ["approve", "reject"].includes(parts[3])
      ) {
        const requestId = parts[2];
        const body = await readJsonBody(req);
        ensureHostId(body.hostId);
        requireHostAvailableForDispatch(body.hostId);

        const response = await invokeHandler(hostHandlers.get(body.hostId), {
          method: "POST",
          url: `/api/approvals/${encodeURIComponent(requestId)}/${parts[3]}`,
          body: JSON.stringify(body)
        });
        return json(res, response.statusCode, {
          hostId: body.hostId,
          ...(response.json || { ok: false })
        });
      }

      if (
        req.method === "GET" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "jobs" &&
        ["live", "result"].includes(parts[3])
      ) {
        const jobId = parts[2];
        const hostId = await resolveHostForJob(jobId);
        const response = await invokeHandler(hostHandlers.get(hostId), {
          method: "GET",
          url: `/api/jobs/${encodeURIComponent(jobId)}/${parts[3]}`
        });
        return json(res, response.statusCode, {
          hostId,
          ...(response.json || { ok: false })
        });
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/hosts/reconcile") {
        const transitions = [];
        for (const [jobId, hostId] of jobRoutes.entries()) {
          const hostRecord = hostRecords.get(hostId);
          if (!hostRecord) {
            continue;
          }
          refreshHostHeartbeat(hostRecord);
          if (hostRecord.heartbeat.status === "online") {
            continue;
          }

          const response = await invokeHandler(hostHandlers.get(hostId), {
            method: "GET",
            url: `/api/jobs/${encodeURIComponent(jobId)}`
          });
          const job = response.json?.job || null;
          if (!job || !NON_TERMINAL_STATES.has(job.state)) {
            continue;
          }

          transitions.push({
            jobId,
            hostId,
            hostStatus: hostRecord.heartbeat.status,
            action: "blocked-by-host-outage"
          });
        }

        return json(res, 200, {
          ok: true,
          transitions
        });
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
