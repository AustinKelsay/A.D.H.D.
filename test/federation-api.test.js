import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

import { createFederationApiHandler } from "../src/server/federation-api.js";
import { RuntimeError } from "../src/runtime/errors.js";
import { JOB_STATES } from "../src/runtime/state-machine.js";

class FakeRuntime extends EventEmitter {
  constructor(hostId) {
    super();
    this.hostId = hostId;
    this.jobs = new Map();
    this.store = new EventEmitter();
    this.pending = [];
    this.approvals = [];
    this.rejections = [];
  }

  createJob({
    jobId,
    inputText,
    intake = null,
    delegationMode = "fallback_workers",
    policySnapshot = null,
    intent = null,
    plan = null,
    delegationDecision = null
  }) {
    const now = new Date().toISOString();
    const job = {
      jobId,
      hostId: this.hostId,
      inputText,
      intake,
      state: JOB_STATES.QUEUED,
      delegationMode,
      intent,
      plan,
      delegationDecision,
      policySnapshot,
      resultSummary: null,
      artifactPaths: [],
      hostJobId: null,
      threadId: null,
      turnId: null,
      timestamps: {
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        endedAt: null
      }
    };
    this.jobs.set(jobId, job);
    this.store.emit("created", structuredClone(job));
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  listJobs() {
    return [...this.jobs.values()];
  }

  async startJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    const now = new Date().toISOString();
    const from = job.state;
    job.state = JOB_STATES.RUNNING;
    job.timestamps.startedAt = now;
    job.timestamps.updatedAt = now;
    this.store.emit("transition", {
      jobId,
      from,
      to: JOB_STATES.RUNNING,
      reason: "start",
      at: now
    });
    this.store.emit("updated", structuredClone(job));
    return job;
  }

  async interruptJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    const now = new Date().toISOString();
    const from = job.state;
    job.state = JOB_STATES.CANCELLED;
    job.timestamps.endedAt = now;
    job.timestamps.updatedAt = now;
    this.store.emit("transition", {
      jobId,
      from,
      to: JOB_STATES.CANCELLED,
      reason: "interrupt",
      at: now
    });
    this.store.emit("updated", structuredClone(job));
    return job;
  }

  async retryJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    if (![JOB_STATES.FAILED, JOB_STATES.CANCELLED, JOB_STATES.COMPLETED].includes(job.state)) {
      throw new RuntimeError("JOB_NOT_TERMINAL", `Job is not terminal: ${jobId}`);
    }
    const now = new Date().toISOString();
    const from = job.state;
    job.state = JOB_STATES.QUEUED;
    job.hostJobId = null;
    job.threadId = null;
    job.turnId = null;
    job.resultSummary = null;
    job.artifactPaths = [];
    job.timestamps.startedAt = null;
    job.timestamps.endedAt = null;
    job.timestamps.updatedAt = now;
    this.store.emit("transition", {
      jobId,
      from,
      to: JOB_STATES.QUEUED,
      reason: "retry",
      at: now
    });
    this.store.emit("updated", structuredClone(job));
    return job;
  }

  approveRequest(requestId, result) {
    this.approvals.push({ requestId, result });
  }

  rejectRequest(requestId, message) {
    this.rejections.push({ requestId, message });
  }

  listPendingApprovals(jobId = null) {
    if (!jobId) {
      return [...this.pending];
    }
    return this.pending.filter((entry) => entry.jobId === jobId);
  }

  getJobResult(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    return {
      resultSummary: job.resultSummary,
      artifactPaths: job.artifactPaths
    };
  }
}

async function invoke(handler, { method, url, body = null, headers = {} }) {
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
  let responseStatusCode = 200;
  const responseHeaders = {};

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

  let json = null;
  if (responseBody.trim()) {
    json = JSON.parse(responseBody);
  }

  return {
    statusCode: responseStatusCode,
    headers: responseHeaders,
    body: responseBody,
    json
  };
}

async function registerEnrollAndHeartbeat(handler, hostId) {
  const registered = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/register",
    body: JSON.stringify({
      hostId,
      displayName: `${hostId}-node`
    })
  });
  assert.equal(registered.statusCode, 201);
  assert.equal(typeof registered.json.enrollmentToken, "string");

  const enrolled = await invoke(handler, {
    method: "POST",
    url: `/api/hosts/${hostId}/enroll`,
    body: JSON.stringify({
      enrollmentToken: registered.json.enrollmentToken,
      capabilities: {
        codexVersion: "0.3.0",
        appServer: true,
        mcp: true,
        mcpServer: true,
        features: {
          multi_agent: {
            stage: "experimental",
            enabled: true
          }
        }
      },
      compatibility: {
        status: "compatible",
        checkedAt: new Date().toISOString(),
        missingMethods: []
      }
    })
  });
  assert.equal(enrolled.statusCode, 200);
  assert.equal(typeof enrolled.json.hostToken, "string");

  const heartbeat = await invoke(handler, {
    method: "POST",
    url: `/api/hosts/${hostId}/heartbeat`,
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${enrolled.json.hostToken}`
    }
  });
  assert.equal(heartbeat.statusCode, 202);
  assert.equal(heartbeat.json.host.heartbeat.status, "online");

  return {
    enrollmentToken: registered.json.enrollmentToken,
    hostToken: enrolled.json.hostToken
  };
}

test("host enrollment requires valid token and heartbeat requires host token", async () => {
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
    }
  });

  const registered = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/register",
    body: JSON.stringify({ hostId: "h_alpha01", displayName: "alpha" })
  });
  assert.equal(registered.statusCode, 201);

  const badEnroll = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/enroll",
    body: JSON.stringify({ enrollmentToken: "wrong" })
  });
  assert.equal(badEnroll.statusCode, 401);
  assert.equal(badEnroll.json.error.code, "HOST_UNAUTHORIZED");

  const enrolled = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/enroll",
    body: JSON.stringify({ enrollmentToken: registered.json.enrollmentToken })
  });
  assert.equal(enrolled.statusCode, 200);

  const badHeartbeat = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/heartbeat",
    body: JSON.stringify({ hostToken: "bad" })
  });
  assert.equal(badHeartbeat.statusCode, 401);
  assert.equal(badHeartbeat.json.error.code, "HOST_UNAUTHORIZED");

  const goodHeartbeat = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/heartbeat",
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${enrolled.json.hostToken}`
    }
  });
  assert.equal(goodHeartbeat.statusCode, 202);
  assert.equal(goodHeartbeat.json.host.heartbeat.status, "online");
});

test("host list and host detail routes return enrolled records", async () => {
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") },
      h_bravo02: { runtime: new FakeRuntime("h_bravo02") }
    }
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  await registerEnrollAndHeartbeat(handler, "h_bravo02");

  const listed = await invoke(handler, {
    method: "GET",
    url: "/api/hosts"
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(Array.isArray(listed.json.hosts), true);
  assert.equal(listed.json.hosts.length, 2);
  assert.equal(listed.json.hosts.every((host) => host.auth.status === "enrolled"), true);

  const detail = await invoke(handler, {
    method: "GET",
    url: "/api/hosts/h_alpha01"
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json.host.hostId, "h_alpha01");
  assert.equal(detail.json.host.auth.status, "enrolled");
});

test("federation routes jobs and controls to the targeted host", async () => {
  const alphaRuntime = new FakeRuntime("h_alpha01");
  const betaRuntime = new FakeRuntime("h_bravo02");
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: alphaRuntime },
      h_bravo02: { runtime: betaRuntime }
    }
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  await registerEnrollAndHeartbeat(handler, "h_bravo02");

  const created = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_bravo02",
      jobId: "j_fed001",
      inputText: "Implement federation routing"
    })
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json.hostId, "h_bravo02");
  assert.equal(betaRuntime.getJob("j_fed001") !== null, true);
  assert.equal(alphaRuntime.getJob("j_fed001"), null);

  const started = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_fed001/start",
    body: JSON.stringify({})
  });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json.hostId, "h_bravo02");
  assert.equal(started.json.job.state, JOB_STATES.RUNNING);

  const loaded = await invoke(handler, {
    method: "GET",
    url: "/api/jobs/j_fed001"
  });
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.json.hostId, "h_bravo02");
  assert.equal(loaded.json.job.jobId, "j_fed001");
});

test("offline hosts block dispatch and start actions deterministically", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    },
    heartbeatDegradedMs: 5,
    heartbeatOfflineMs: 10
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const created = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_fed_offline",
      inputText: "Do work"
    })
  });
  assert.equal(created.statusCode, 201);

  await new Promise((resolve) => setTimeout(resolve, 20));

  const blockedStart = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_fed_offline/start",
    body: JSON.stringify({})
  });
  assert.equal(blockedStart.statusCode, 503);
  assert.equal(blockedStart.json.error.code, "HOST_OFFLINE");

  const blockedCreate = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_fed_offline_2",
      inputText: "Should be blocked"
    })
  });
  assert.equal(blockedCreate.statusCode, 503);
  assert.equal(blockedCreate.json.error.code, "HOST_OFFLINE");

  const reconcile = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/reconcile",
    body: JSON.stringify({})
  });
  assert.equal(reconcile.statusCode, 200);
  assert.equal(reconcile.json.transitions.some((entry) => entry.jobId === "j_fed_offline"), true);
});

test("revoked host cannot accept new dispatches", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    }
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const revoked = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/revoke",
    body: JSON.stringify({})
  });
  assert.equal(revoked.statusCode, 202);
  assert.equal(revoked.json.host.auth.status, "revoked");

  const create = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      inputText: "Do not dispatch"
    })
  });
  assert.equal(create.statusCode, 409);
  assert.equal(create.json.error.code, "HOST_REVOKED");
});

test("revoked host heartbeat is rejected", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    }
  });

  const { hostToken } = await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const revoked = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/revoke",
    body: JSON.stringify({})
  });
  assert.equal(revoked.statusCode, 202);

  const heartbeat = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/heartbeat",
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${hostToken}`
    }
  });
  assert.equal(heartbeat.statusCode, 409);
  assert.equal(heartbeat.json.error.code, "HOST_NOT_ENROLLED");
});

test("approval routes are host-aware and forwarded to correct runtime", async () => {
  const alphaRuntime = new FakeRuntime("h_alpha01");
  const betaRuntime = new FakeRuntime("h_bravo02");
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: alphaRuntime },
      h_bravo02: { runtime: betaRuntime }
    }
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  await registerEnrollAndHeartbeat(handler, "h_bravo02");

  const approved = await invoke(handler, {
    method: "POST",
    url: "/api/approvals/77/approve",
    body: JSON.stringify({
      hostId: "h_bravo02",
      result: { approved: true }
    })
  });
  assert.equal(approved.statusCode, 202);
  assert.equal(betaRuntime.approvals.length, 1);
  assert.equal(betaRuntime.approvals[0].requestId, 77);
  assert.equal(alphaRuntime.approvals.length, 0);

  const rejected = await invoke(handler, {
    method: "POST",
    url: "/api/approvals/77/reject",
    body: JSON.stringify({
      hostId: "h_bravo02",
      message: "deny"
    })
  });
  assert.equal(rejected.statusCode, 202);
  assert.equal(betaRuntime.rejections.length, 1);
  assert.equal(betaRuntime.rejections[0].requestId, 77);
  assert.equal(alphaRuntime.rejections.length, 0);
});

test("invalid hostId format is rejected for register and dispatch", async () => {
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
    }
  });

  const badRegister = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/register",
    body: JSON.stringify({
      hostId: "bad-host"
    })
  });
  assert.equal(badRegister.statusCode, 400);
  assert.equal(badRegister.json.error.code, "INVALID_INPUT");

  const badDispatch = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "BAD",
      inputText: "x"
    })
  });
  assert.equal(badDispatch.statusCode, 400);
  assert.equal(badDispatch.json.error.code, "INVALID_INPUT");
});
