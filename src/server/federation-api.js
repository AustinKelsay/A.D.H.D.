import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { RuntimeError } from "../runtime/errors.js";
import { createHostApiHandler } from "./host-api.js";

export const HOST_ID_PATTERN = /^h_[a-z0-9]{6,}$/;
const ALLOWED_JOB_STATES = new Set([
  "draft",
  "queued",
  "dispatching",
  "planning",
  "awaiting_approval",
  "delegating",
  "running",
  "summarizing",
  "completed",
  "failed",
  "cancelled"
]);
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
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_ENROLLMENT_TOKEN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CATALOG_LIMIT = 50;
const MAX_CATALOG_LIMIT = 500;
const RUN_CATALOG_VERSION = "run-catalog.v1";

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function parsePositiveInt(value, {
  name,
  defaultValue,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
}) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const rawValue = String(value).trim();
  const integerPattern = min >= 0 ? /^\d+$/ : /^-?\d+$/;
  if (!integerPattern.test(rawValue)) {
    throw new RuntimeError("INVALID_INPUT", `${name} must be an integer in range ${min}-${max}`);
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RuntimeError("INVALID_INPUT", `${name} must be an integer in range ${min}-${max}`);
  }
  return parsed;
}

function parseOptionalIsoDate(value, name) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsedMs = Date.parse(String(value));
  if (!Number.isFinite(parsedMs)) {
    throw new RuntimeError("INVALID_INPUT", `${name} must be a valid date/time`);
  }
  return parsedMs;
}

function parseStateFilter(stateParam) {
  if (!stateParam) {
    return null;
  }

  const states = String(stateParam)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (states.length === 0) {
    return null;
  }

  for (const state of states) {
    if (!ALLOWED_JOB_STATES.has(state)) {
      throw new RuntimeError("INVALID_INPUT", `state filter includes unsupported state: ${state}`);
    }
  }
  return states;
}

function parseRunCatalogQuery(reqUrl) {
  const limit = parsePositiveInt(reqUrl.searchParams.get("limit"), {
    name: "limit",
    defaultValue: DEFAULT_CATALOG_LIMIT,
    min: 1,
    max: MAX_CATALOG_LIMIT
  });
  const offset = parsePositiveInt(reqUrl.searchParams.get("offset"), {
    name: "offset",
    defaultValue: 0,
    min: 0,
    max: 1000000
  });

  const hostId = reqUrl.searchParams.get("hostId") || null;
  if (hostId !== null) {
    ensureHostId(hostId);
  }

  const states = parseStateFilter(reqUrl.searchParams.get("state"));
  const repo = reqUrl.searchParams.get("repo");
  const qRaw = reqUrl.searchParams.get("q");
  const q = typeof qRaw === "string" && qRaw.trim().length > 0 ? qRaw.trim().toLowerCase() : null;
  const fromMs = parseOptionalIsoDate(reqUrl.searchParams.get("from"), "from");
  const toMs = parseOptionalIsoDate(reqUrl.searchParams.get("to"), "to");

  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    throw new RuntimeError("INVALID_INPUT", "from must be before or equal to to");
  }

  return {
    hostId,
    states,
    repo: typeof repo === "string" && repo.trim().length > 0 ? repo.trim().toLowerCase() : null,
    q,
    fromMs,
    toMs,
    limit,
    offset
  };
}

function resolveRepoPath(job = {}) {
  const candidates = [
    job.intent?.target,
    job.plan?.target,
    job.intent?.metadata?.repoPath,
    job.intent?.metadata?.repo,
    job.intent?.metadata?.repository
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function buildCatalogEntry(job, { hostId, source = null, persistedAt = nowIso() } = {}) {
  if (!job || typeof job !== "object" || !job.jobId) {
    return null;
  }

  return {
    catalogVersion: RUN_CATALOG_VERSION,
    jobId: job.jobId,
    hostId: hostId || job.hostId || null,
    state: job.state || null,
    delegationMode: job.delegationMode || null,
    repoPath: resolveRepoPath(job),
    inputText: typeof job.inputText === "string" ? job.inputText : null,
    resultSummary: typeof job.resultSummary === "string" ? job.resultSummary : null,
    artifactPaths: Array.isArray(job.artifactPaths) ? [...job.artifactPaths] : [],
    timestamps: clone(job.timestamps || {}),
    source: source ? clone(source) : null,
    persistedAt,
    job: clone(job)
  };
}

function createRunCatalog({ catalogStorePath = null } = {}) {
  const entries = new Map();
  const resolvedPath = typeof catalogStorePath === "string" && catalogStorePath.trim()
    ? path.resolve(catalogStorePath.trim())
    : null;

  const load = () => {
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    } catch {
      return;
    }

    if (!Array.isArray(parsed?.entries)) {
      return;
    }

    for (const entry of parsed.entries) {
      if (!entry || typeof entry !== "object" || typeof entry.jobId !== "string") {
        continue;
      }
      entries.set(entry.jobId, clone(entry));
    }
  };

  const flush = () => {
    if (!resolvedPath) {
      return;
    }
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const tempPath = `${resolvedPath}.tmp`;
    const payload = {
      version: RUN_CATALOG_VERSION,
      updatedAt: nowIso(),
      entries: [...entries.values()]
    };
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, resolvedPath);
  };

  const upsert = (entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.jobId !== "string") {
      return null;
    }

    const previous = entries.get(entry.jobId) || null;
    const merged = previous
      ? {
          ...previous,
          ...clone(entry),
          timestamps: {
            ...(previous.timestamps || {}),
            ...(entry.timestamps || {})
          },
          source: entry.source === null || entry.source === undefined
            ? previous.source ?? null
            : clone(entry.source),
          job: entry.job ? clone(entry.job) : previous.job
        }
      : clone(entry);

    entries.set(merged.jobId, merged);
    flush();
    return clone(merged);
  };

  const upsertFromJob = (job, { hostId, source = null } = {}) => {
    const entry = buildCatalogEntry(job, { hostId, source });
    if (!entry) {
      return null;
    }
    return upsert(entry);
  };

  load();

  return {
    path: resolvedPath,
    list() {
      return [...entries.values()].map(clone);
    },
    get(jobId) {
      const entry = entries.get(jobId);
      return entry ? clone(entry) : null;
    },
    upsert,
    upsertFromJob
  };
}

function filterCatalogEntries(entries, query) {
  const filtered = entries.filter((entry) => {
    if (query.hostId && entry.hostId !== query.hostId) {
      return false;
    }

    if (query.states && !query.states.includes(entry.state)) {
      return false;
    }

    if (query.repo) {
      const repoPath = typeof entry.repoPath === "string" ? entry.repoPath.toLowerCase() : "";
      if (!repoPath.includes(query.repo)) {
        return false;
      }
    }

    const createdAtMs = Date.parse(entry.timestamps?.createdAt || entry.timestamps?.updatedAt || entry.persistedAt || "");
    if (query.fromMs !== null && (!Number.isFinite(createdAtMs) || createdAtMs < query.fromMs)) {
      return false;
    }
    if (query.toMs !== null && (!Number.isFinite(createdAtMs) || createdAtMs > query.toMs)) {
      return false;
    }

    if (query.q) {
      const haystack = [
        entry.jobId,
        entry.hostId,
        entry.inputText,
        entry.resultSummary,
        entry.repoPath
      ]
        .filter((part) => typeof part === "string")
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query.q)) {
        return false;
      }
    }
    return true;
  });

  filtered.sort((a, b) => {
    const aMs = Date.parse(a.timestamps?.updatedAt || a.persistedAt || 0);
    const bMs = Date.parse(b.timestamps?.updatedAt || b.persistedAt || 0);
    return bMs - aMs;
  });

  const paged = filtered.slice(query.offset, query.offset + query.limit);
  return {
    jobs: paged.map((entry) => clone(entry.job || {
      jobId: entry.jobId,
      hostId: entry.hostId,
      state: entry.state,
      delegationMode: entry.delegationMode,
      inputText: entry.inputText,
      resultSummary: entry.resultSummary,
      artifactPaths: entry.artifactPaths,
      timestamps: entry.timestamps
    })),
    catalog: paged.map(clone),
    pagination: {
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
      returned: paged.length,
      hasMore: query.offset + paged.length < filtered.length
    },
    filters: {
      hostId: query.hostId,
      state: query.states,
      repo: query.repo,
      q: query.q,
      from: query.fromMs === null ? null : new Date(query.fromMs).toISOString(),
      to: query.toMs === null ? null : new Date(query.toMs).toISOString()
    }
  };
}

function buildClonePayloadFromCatalogEntry(entry, {
  jobId = null,
  startNow = false,
  startParams = {}
} = {}) {
  const sourceJob = entry?.job || {};
  const payload = {
    inputText: sourceJob.inputText,
    intake: sourceJob.intake ?? null,
    intent: sourceJob.intent ?? null,
    plan: sourceJob.plan ?? null,
    policySnapshot: sourceJob.policySnapshot ?? null
  };

  if (typeof jobId === "string" && jobId.trim()) {
    payload.jobId = jobId.trim();
  }
  if (startNow === true) {
    payload.autoStart = true;
    payload.startParams = startParams && typeof startParams === "object" && !Array.isArray(startParams)
      ? startParams
      : {};
  }
  return payload;
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
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_JSON_BODY_BYTES) {
      throw new RuntimeError("INVALID_INPUT", "Request body too large");
    }
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
  return reqUrl.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch (error) {
        throw new RuntimeError("INVALID_INPUT", `Invalid URL path segment encoding: ${part}`, {
          cause: error?.message || "decode-failed"
        });
      }
    });
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

    Promise.resolve(handler(req, res))
      .then(() => {
        if (!ended) {
          res.end();
        }
      })
      .catch((error) => {
        if (ended) {
          return;
        }
        responseStatusCode = 500;
        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: error?.code || "INTERNAL_ERROR",
              message: error?.message || "Unhandled nested handler error"
            }
          })
        );
      });
  });

  await done;

  let jsonBody = null;
  if (responseBody.trim()) {
    try {
      jsonBody = JSON.parse(responseBody);
    } catch {
      jsonBody = null;
    }
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
  if (code === "CONTROL_PLANE_UNAUTHORIZED") {
    return 401;
  }
  if (code === "CONTROL_PLANE_FORBIDDEN") {
    return 403;
  }
  if (code === "HOST_NOT_FOUND" || code === "JOB_NOT_FOUND") {
    return 404;
  }
  if (code === "HOST_UNAUTHORIZED") {
    return 401;
  }
  if (code === "HOST_NOT_READY") {
    return 503;
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
  verifyControlPlaneToken,
  catalogStorePath = null,
  enrollmentTokenTtlMs = DEFAULT_ENROLLMENT_TOKEN_TTL_MS,
  heartbeatDegradedMs = 15000,
  heartbeatOfflineMs = 30000
} = {}) {
  const safeEnrollmentTokenTtlMs = Number.isSafeInteger(enrollmentTokenTtlMs) && enrollmentTokenTtlMs > 0
    ? enrollmentTokenTtlMs
    : DEFAULT_ENROLLMENT_TOKEN_TTL_MS;
  const hostRecords = new Map();
  const enrollmentTokens = new Map();
  const hostSessionTokens = new Map();
  const jobRoutes = new Map();
  const runCatalog = createRunCatalog({ catalogStorePath });

  for (const entry of runCatalog.list()) {
    if (typeof entry.jobId === "string" && typeof entry.hostId === "string") {
      jobRoutes.set(entry.jobId, entry.hostId);
    }
  }

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

    const catalogEntry = runCatalog.get(jobId);
    if (catalogEntry?.hostId) {
      jobRoutes.set(jobId, catalogEntry.hostId);
      return catalogEntry.hostId;
    }

    for (const [hostId, handler] of hostHandlers.entries()) {
      const response = await invokeHandler(handler, {
        method: "GET",
        url: `/api/jobs/${encodeURIComponent(jobId)}`
      });
      if (response.statusCode === 200 && response.json?.job?.jobId === jobId) {
        runCatalog.upsertFromJob(response.json.job, {
          hostId,
          source: {
            kind: "live-discovery"
          }
        });
        jobRoutes.set(jobId, hostId);
        return hostId;
      }
    }

    throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
  };

  const upsertCatalogFromResponse = (response, { hostId, source = null } = {}) => {
    const job = response?.json?.job;
    if (!job || typeof job !== "object") {
      return null;
    }
    const resolvedHostId = hostId || response?.json?.hostId || job.hostId || null;
    const entry = runCatalog.upsertFromJob(job, {
      hostId: resolvedHostId,
      source
    });
    if (entry?.jobId && entry?.hostId) {
      jobRoutes.set(entry.jobId, entry.hostId);
    }
    return entry;
  };

  const requireCatalogJob = async (jobId) => {
    const existing = runCatalog.get(jobId);
    if (existing?.job) {
      return existing;
    }

    const hostId = await resolveHostForJob(jobId);
    const response = await invokeHandler(hostHandlers.get(hostId), {
      method: "GET",
      url: `/api/jobs/${encodeURIComponent(jobId)}`
    });
    if (response.statusCode !== 200 || !response.json?.job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    const entry = upsertCatalogFromResponse(response, {
      hostId,
      source: {
        kind: "catalog-refresh"
      }
    });
    if (!entry) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    return entry;
  };

  const setEnrollmentToken = (hostId, token, nowMs = Date.now()) => {
    enrollmentTokens.set(hostId, {
      token,
      expiresAt: new Date(nowMs + safeEnrollmentTokenTtlMs).toISOString()
    });
  };

  const readValidEnrollmentToken = (hostId, nowMs = Date.now()) => {
    const entry = enrollmentTokens.get(hostId);
    if (!entry) {
      return null;
    }
    const expiresAtMs = Date.parse(entry.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      enrollmentTokens.delete(hostId);
      return null;
    }
    return entry.token;
  };

  const assertControlPlaneAuthorized = async (req, context) => {
    if (typeof verifyControlPlaneToken !== "function") {
      return;
    }

    try {
      const decision = await verifyControlPlaneToken({
        req,
        headers: req.headers || {},
        method: req.method,
        path: context?.path || req.url || "",
        action: context?.action || null
      });
      if (decision === false) {
        throw new RuntimeError("CONTROL_PLANE_UNAUTHORIZED", "Control-plane auth rejected request");
      }
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw error;
      }
      throw new RuntimeError("CONTROL_PLANE_FORBIDDEN", "Control-plane auth check failed", {
        cause: error?.message || "auth-check-failed"
      });
    }
  };

  return async function handler(req, res) {
    try {
      const reqUrl = new URL(req.url, "http://127.0.0.1");
      const parts = pathParts(reqUrl);

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
        await assertControlPlaneAuthorized(req, {
          path: reqUrl.pathname,
          action: "host-register"
        });
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
        setEnrollmentToken(hostId, enrollmentToken);
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

        const expectedToken = readValidEnrollmentToken(hostId);
        if (!expectedToken || body.enrollmentToken !== expectedToken) {
          throw new RuntimeError("HOST_UNAUTHORIZED", "Invalid enrollment token");
        }

        const enrolledAt = nowIso();
        record.auth.status = "enrolled";
        record.auth.tokenId = `tok_${randomBytes(6).toString("hex")}`;
        record.heartbeat.lastSeenAt = enrolledAt;
        record.capabilities = normalizeCapabilities(body.capabilities);
        record.compatibility = normalizeCompatibility(body.compatibility);
        record.updatedAt = enrolledAt;
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
        await assertControlPlaneAuthorized(req, {
          path: reqUrl.pathname,
          action: "host-revoke"
        });
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
        await assertControlPlaneAuthorized(req, {
          path: reqUrl.pathname,
          action: "job-dispatch"
        });
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
          runCatalog.upsertFromJob(job, {
            hostId: targetHostId,
            source: {
              kind: "dispatch",
              parentJobId: null
            }
          });
        }

        return json(res, 201, {
          ok: true,
          hostId: targetHostId,
          ...response.json
        });
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/jobs") {
        const query = parseRunCatalogQuery(reqUrl);
        const targetHostIds = query.hostId ? [query.hostId] : [...hostHandlers.keys()];

        for (const hostId of targetHostIds) {
          if (!hostHandlers.has(hostId)) {
            continue;
          }

          const response = await invokeHandler(hostHandlers.get(hostId), {
            method: "GET",
            url: "/api/jobs?limit=500&offset=0"
          });
          if (response.statusCode !== 200 || !Array.isArray(response.json?.jobs)) {
            continue;
          }

          for (const job of response.json.jobs) {
            runCatalog.upsertFromJob(job, {
              hostId,
              source: {
                kind: "live-sync",
                parentJobId: null
              }
            });
            if (job?.jobId) {
              jobRoutes.set(job.jobId, hostId);
            }
          }
        }

        const filtered = filterCatalogEntries(runCatalog.list(), query);

        return json(res, 200, {
          ok: true,
          jobs: filtered.jobs,
          catalog: filtered.catalog,
          pagination: filtered.pagination,
          filters: filtered.filters
        });
      }

      if (req.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "jobs") {
        const jobId = parts[2];
        const hostId = await resolveHostForJob(jobId);

        if (!hostHandlers.has(hostId)) {
          const entry = runCatalog.get(jobId);
          if (entry?.job) {
            return json(res, 200, {
              ok: true,
              hostId,
              job: entry.job,
              catalog: entry
            });
          }
          throw new RuntimeError("HOST_NOT_READY", `No runtime bound for host: ${hostId}`);
        }

        const response = await invokeHandler(hostHandlers.get(hostId), {
          method: "GET",
          url: `/api/jobs/${encodeURIComponent(jobId)}`
        });
        if (response.statusCode === 200) {
          upsertCatalogFromResponse(response, {
            hostId,
            source: {
              kind: "live-read",
              parentJobId: null
            }
          });
        }
        if (response.statusCode === 404) {
          const entry = runCatalog.get(jobId);
          if (entry?.job) {
            return json(res, 200, {
              ok: true,
              hostId,
              job: entry.job,
              catalog: entry
            });
          }
        }
        return json(res, response.statusCode, {
          hostId,
          ...(response.json || { ok: false }),
          catalog: runCatalog.get(jobId)
        });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "jobs" &&
        ["start", "interrupt", "retry"].includes(parts[3])
      ) {
        await assertControlPlaneAuthorized(req, {
          path: reqUrl.pathname,
          action: `job-${parts[3]}`
        });
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
        if (response.statusCode < 400) {
          upsertCatalogFromResponse(response, {
            hostId,
            source: {
              kind: action,
              parentJobId: jobId
            }
          });
        }
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
        parts[3] === "rerun"
      ) {
        await assertControlPlaneAuthorized(req, {
          path: reqUrl.pathname,
          action: "job-rerun"
        });
        const jobId = parts[2];
        const body = await readJsonBody(req);
        const hostId = await resolveHostForJob(jobId);
        requireHostAvailableForDispatch(hostId);

        const retryPayload = {
          startNow: body.startNow !== false,
          startParams: body.startParams && typeof body.startParams === "object" && !Array.isArray(body.startParams)
            ? body.startParams
            : {}
        };
        const retryResponse = await invokeHandler(hostHandlers.get(hostId), {
          method: "POST",
          url: `/api/jobs/${encodeURIComponent(jobId)}/retry`,
          body: JSON.stringify(retryPayload)
        });

        if (retryResponse.statusCode < 400) {
          upsertCatalogFromResponse(retryResponse, {
            hostId,
            source: {
              kind: "rerun",
              parentJobId: jobId
            }
          });
          return json(res, retryResponse.statusCode, {
            ok: true,
            hostId,
            replayMode: "rerun",
            ...(retryResponse.json || { ok: false })
          });
        }

        const shouldFallbackToClone = body.cloneIfMissing !== false;
        if (!shouldFallbackToClone || retryResponse.json?.error?.code !== "JOB_NOT_FOUND") {
          return json(res, retryResponse.statusCode, {
            hostId,
            ...(retryResponse.json || { ok: false })
          });
        }

        const sourceEntry = await requireCatalogJob(jobId);
        const clonePayload = buildClonePayloadFromCatalogEntry(sourceEntry, {
          jobId: body.jobId,
          startNow: retryPayload.startNow,
          startParams: retryPayload.startParams
        });
        const cloneResponse = await invokeHandler(hostHandlers.get(hostId), {
          method: "POST",
          url: "/api/intake",
          body: JSON.stringify(clonePayload)
        });
        if (cloneResponse.statusCode >= 400) {
          return json(res, cloneResponse.statusCode, {
            hostId,
            ...(cloneResponse.json || { ok: false })
          });
        }
        upsertCatalogFromResponse(cloneResponse, {
          hostId,
          source: {
            kind: "rerun-clone-fallback",
            parentJobId: jobId
          }
        });
        return json(res, 201, {
          ok: true,
          hostId,
          replayMode: "rerun-clone-fallback",
          sourceJobId: jobId,
          ...(cloneResponse.json || { ok: false })
        });
      }

      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "jobs" &&
        parts[3] === "clone"
      ) {
        await assertControlPlaneAuthorized(req, {
          path: reqUrl.pathname,
          action: "job-clone"
        });
        const sourceJobId = parts[2];
        const body = await readJsonBody(req);
        const sourceEntry = await requireCatalogJob(sourceJobId);
        const targetHostId = body.hostId || sourceEntry.hostId;
        ensureHostId(targetHostId);
        requireHostAvailableForDispatch(targetHostId);

        const clonePayload = buildClonePayloadFromCatalogEntry(sourceEntry, {
          jobId: body.jobId,
          startNow: body.startNow === true,
          startParams: body.startParams
        });
        const response = await invokeHandler(hostHandlers.get(targetHostId), {
          method: "POST",
          url: "/api/intake",
          body: JSON.stringify(clonePayload)
        });
        if (response.statusCode >= 400) {
          return json(res, response.statusCode, {
            hostId: targetHostId,
            ...(response.json || { ok: false })
          });
        }

        const entry = upsertCatalogFromResponse(response, {
          hostId: targetHostId,
          source: {
            kind: "clone",
            parentJobId: sourceJobId
          }
        });
        return json(res, 201, {
          ok: true,
          hostId: targetHostId,
          sourceJobId,
          clonedJobId: entry?.jobId || response.json?.job?.jobId || null,
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
        await assertControlPlaneAuthorized(req, {
          path: reqUrl.pathname,
          action: `approval-${parts[3]}`
        });
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

        if (parts[3] === "live" && response.statusCode === 200) {
          upsertCatalogFromResponse(response, {
            hostId,
            source: {
              kind: "live-read",
              parentJobId: null
            }
          });
        } else if (parts[3] === "result" && response.statusCode === 200) {
          const existing = runCatalog.get(jobId);
          if (existing?.job) {
            const patchedJob = {
              ...existing.job,
              resultSummary: response.json?.result?.resultSummary ?? existing.job.resultSummary ?? null,
              artifactPaths: Array.isArray(response.json?.result?.artifactPaths)
                ? response.json.result.artifactPaths
                : existing.job.artifactPaths
            };
            runCatalog.upsertFromJob(patchedJob, {
              hostId,
              source: {
                kind: "result-read",
                parentJobId: null
              }
            });
          }
        }

        return json(res, response.statusCode, {
          hostId,
          ...(response.json || { ok: false })
        });
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/hosts/reconcile") {
        await assertControlPlaneAuthorized(req, {
          path: reqUrl.pathname,
          action: "hosts-reconcile"
        });
        const transitions = [];
        for (const [jobId, hostId] of jobRoutes.entries()) {
          const hostRecord = hostRecords.get(hostId);
          if (!hostRecord) {
            continue;
          }
          if (!hostHandlers.has(hostId)) {
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
