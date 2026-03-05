import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
              message: error?.message || "Unhandled test invoke error"
            }
          })
        );
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

async function registerEnrollAndHeartbeat(handler, hostId, { registerHeaders = {} } = {}) {
  const registered = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/register",
    body: JSON.stringify({
      hostId,
      displayName: `${hostId}-node`
    }),
    headers: registerHeaders
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

test("control-plane auth hook blocks privileged routes without operator token", async () => {
  const operatorToken = "cp_secret";
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
    },
    verifyControlPlaneToken: ({ headers }) => headers?.authorization === `Bearer ${operatorToken}`
  });

  const unauthorizedRegister = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/register",
    body: JSON.stringify({ hostId: "h_alpha01" })
  });
  assert.equal(unauthorizedRegister.statusCode, 401);
  assert.equal(unauthorizedRegister.json.error.code, "CONTROL_PLANE_UNAUTHORIZED");

  const { hostToken } = await registerEnrollAndHeartbeat(handler, "h_alpha01", {
    registerHeaders: {
      authorization: `Bearer ${operatorToken}`
    }
  });

  const unauthorizedDispatch = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_auth001",
      inputText: "secure dispatch"
    })
  });
  assert.equal(unauthorizedDispatch.statusCode, 401);
  assert.equal(unauthorizedDispatch.json.error.code, "CONTROL_PLANE_UNAUTHORIZED");

  const authorizedDispatch = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    headers: {
      authorization: `Bearer ${operatorToken}`
    },
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_auth001",
      inputText: "secure dispatch"
    })
  });
  assert.equal(authorizedDispatch.statusCode, 201);

  const unauthorizedReconcile = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/reconcile",
    body: JSON.stringify({})
  });
  assert.equal(unauthorizedReconcile.statusCode, 401);
  assert.equal(unauthorizedReconcile.json.error.code, "CONTROL_PLANE_UNAUTHORIZED");

  const authorizedReconcile = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/reconcile",
    headers: {
      authorization: `Bearer ${operatorToken}`
    },
    body: JSON.stringify({})
  });
  assert.equal(authorizedReconcile.statusCode, 200);

  const heartbeat = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/heartbeat",
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${hostToken}`
    }
  });
  assert.equal(heartbeat.statusCode, 202);

  const unauthorizedRerun = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_auth001/rerun",
    body: JSON.stringify({})
  });
  assert.equal(unauthorizedRerun.statusCode, 401);
  assert.equal(unauthorizedRerun.json.error.code, "CONTROL_PLANE_UNAUTHORIZED");

  const unauthorizedClone = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_auth001/clone",
    body: JSON.stringify({
      jobId: "j_auth_clone001"
    })
  });
  assert.equal(unauthorizedClone.statusCode, 401);
  assert.equal(unauthorizedClone.json.error.code, "CONTROL_PLANE_UNAUTHORIZED");
});

test("invalid workflowDriftPolicy fails fast with INVALID_CONFIG", async () => {
  assert.throws(
    () => createFederationApiHandler({
      hosts: {
        h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
      },
      workflowDriftPolicy: " BLOCK_IF_DRIFT "
    }),
    (error) => error instanceof RuntimeError && error.code === "INVALID_CONFIG"
  );
});

test("enrollment token expires based on configured ttl", async () => {
  let nowMs = Date.now();
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
    },
    enrollmentTokenTtlMs: 50,
    getNow: () => nowMs
  });

  const registered = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/register",
    body: JSON.stringify({
      hostId: "h_alpha01",
      displayName: "alpha"
    })
  });
  assert.equal(registered.statusCode, 201);

  nowMs += 100;
  const expiredEnroll = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/enroll",
    body: JSON.stringify({
      enrollmentToken: registered.json.enrollmentToken
    })
  });

  assert.equal(expiredEnroll.statusCode, 401);
  assert.equal(expiredEnroll.json.error.code, "HOST_UNAUTHORIZED");
});

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

  const bodyOnlyHeartbeat = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/heartbeat",
    body: JSON.stringify({ hostToken: enrolled.json.hostToken })
  });
  assert.equal(bodyOnlyHeartbeat.statusCode, 401);
  assert.equal(bodyOnlyHeartbeat.json.error.code, "HOST_UNAUTHORIZED");

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

test("health exposes workflow drift summary from host workflow hashes", async () => {
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") },
      h_bravo02: { runtime: new FakeRuntime("h_bravo02") }
    },
    expectedWorkflowHash: "wf_expected_hash",
    workflowDriftPolicy: "warn"
  });

  const alpha = await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const bravo = await registerEnrollAndHeartbeat(handler, "h_bravo02");

  const heartbeatAlpha = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/heartbeat",
    headers: {
      authorization: `Bearer ${alpha.hostToken}`
    },
    body: JSON.stringify({
      workflow: {
        status: "loaded",
        contentHash: "wf_expected_hash"
      }
    })
  });
  assert.equal(heartbeatAlpha.statusCode, 202);

  const heartbeatBravo = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_bravo02/heartbeat",
    headers: {
      authorization: `Bearer ${bravo.hostToken}`
    },
    body: JSON.stringify({
      workflow: {
        status: "loaded",
        contentHash: "wf_drift_hash"
      }
    })
  });
  assert.equal(heartbeatBravo.statusCode, 202);

  const health = await invoke(handler, {
    method: "GET",
    url: "/health"
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json.workflow.expectedContentHash, "wf_expected_hash");
  assert.equal(health.json.workflow.driftPolicy, "warn");
  assert.equal(health.json.workflow.driftedHosts.length, 1);
  assert.equal(health.json.workflow.driftedHosts[0].hostId, "h_bravo02");
});

test("block_dispatch drift policy rejects dispatch to drifted host", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    },
    expectedWorkflowHash: "wf_expected_hash",
    workflowDriftPolicy: "block_dispatch"
  });

  const { hostToken } = await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const heartbeat = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/h_alpha01/heartbeat",
    headers: {
      authorization: `Bearer ${hostToken}`
    },
    body: JSON.stringify({
      workflow: {
        status: "loaded",
        contentHash: "wf_drift_hash"
      }
    })
  });
  assert.equal(heartbeat.statusCode, 202);

  const dispatch = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_drift001",
      inputText: "should be blocked by drift policy"
    })
  });
  assert.equal(dispatch.statusCode, 409);
  assert.equal(dispatch.json.error.code, "HOST_WORKFLOW_DRIFT");
});

test("metrics route reports host lifecycle counters", async () => {
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
    }
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const metrics = await invoke(handler, {
    method: "GET",
    url: "/metrics"
  });
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.json.metrics.counters.hostRegisters, 1);
  assert.equal(metrics.json.metrics.counters.hostEnrollments, 1);
  assert.equal(metrics.json.metrics.counters.hostHeartbeats >= 1, true);
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

test("jobs catalog supports host/state/repo/date filters across hosts", async () => {
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

  const createdAlpha = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_cat001",
      inputText: "Fix alpha bug",
      intent: {
        rawText: "Fix alpha bug",
        target: "/repos/alpha-app"
      }
    })
  });
  assert.equal(createdAlpha.statusCode, 201);

  const createdBravo = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_bravo02",
      jobId: "j_cat002",
      inputText: "Fix bravo bug",
      intent: {
        rawText: "Fix bravo bug",
        target: "/repos/bravo-app"
      }
    })
  });
  assert.equal(createdBravo.statusCode, 201);

  const startedBravo = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_cat002/start",
    body: JSON.stringify({})
  });
  assert.equal(startedBravo.statusCode, 200);

  const filtered = await invoke(handler, {
    method: "GET",
    url: "/api/jobs?hostId=h_alpha01&state=queued&repo=alpha-app&from=2020-01-01T00:00:00.000Z&to=2099-01-01T00:00:00.000Z"
  });
  assert.equal(filtered.statusCode, 200);
  assert.equal(filtered.json.jobs.length, 1);
  assert.equal(filtered.json.jobs[0].jobId, "j_cat001");
  assert.equal(filtered.json.catalog.length, 1);
  assert.equal(filtered.json.catalog[0].hostId, "h_alpha01");
  assert.equal(filtered.json.catalog[0].repoPath, "/repos/alpha-app");
  assert.equal(filtered.json.filters.hostId, "h_alpha01");
  assert.deepEqual(filtered.json.filters.state, ["queued"]);
});

test("jobs catalog sync iterates host pagination until all pages are read", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  for (let index = 0; index < 520; index += 1) {
    runtime.createJob({
      jobId: `j_page${index}`,
      inputText: `Bulk job ${index}`
    });
  }

  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    }
  });
  await registerEnrollAndHeartbeat(handler, "h_alpha01");

  const response = await invoke(handler, {
    method: "GET",
    url: "/api/jobs?q=j_page519&limit=10"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.pagination.total, 1);
  assert.equal(response.json.jobs[0].jobId, "j_page519");
});

test("clone route replays a job onto preserved host context", async () => {
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
      jobId: "j_clone_src001",
      inputText: "Compile release notes",
      intent: {
        rawText: "Compile release notes",
        target: "/repos/bravo-app"
      }
    })
  });
  assert.equal(created.statusCode, 201);

  const cloned = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_clone_src001/clone",
    body: JSON.stringify({
      jobId: "j_clone_new001",
      startNow: true
    })
  });
  assert.equal(cloned.statusCode, 201);
  assert.equal(cloned.json.hostId, "h_bravo02");
  assert.equal(cloned.json.sourceJobId, "j_clone_src001");
  assert.equal(cloned.json.job.jobId, "j_clone_new001");
  assert.equal(cloned.json.job.state, JOB_STATES.RUNNING);
  assert.equal(betaRuntime.getJob("j_clone_new001") !== null, true);
  assert.equal(alphaRuntime.getJob("j_clone_new001"), null);
});

test("rerun route retries and starts the same job on its routed host", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    }
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const created = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_rerun001",
      inputText: "Run once and rerun"
    })
  });
  assert.equal(created.statusCode, 201);

  const started = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_rerun001/start",
    body: JSON.stringify({})
  });
  assert.equal(started.statusCode, 200);

  const interrupted = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_rerun001/interrupt",
    body: JSON.stringify({})
  });
  assert.equal(interrupted.statusCode, 200);
  assert.equal(interrupted.json.job.state, JOB_STATES.CANCELLED);

  const rerun = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_rerun001/rerun",
    body: JSON.stringify({})
  });
  assert.equal(rerun.statusCode, 200);
  assert.equal(rerun.json.replayMode, "rerun");
  assert.equal(rerun.json.hostId, "h_alpha01");
  assert.equal(rerun.json.job.state, JOB_STATES.RUNNING);
});

test("rerun route returns JOB_NOT_FOUND when clone fallback is disabled", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    }
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const created = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_rerun_missing001",
      inputText: "Catalog remembers this"
    })
  });
  assert.equal(created.statusCode, 201);

  runtime.jobs.delete("j_rerun_missing001");

  const rerun = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_rerun_missing001/rerun",
    body: JSON.stringify({
      cloneIfMissing: false
    })
  });
  assert.equal(rerun.statusCode, 404);
  assert.equal(rerun.json.error.code, "JOB_NOT_FOUND");

  const missingClone = runtime.getJob("j_rerun_missing001_clone");
  assert.equal(missingClone, null);
});

test("jobs catalog validates filter inputs and returns 400 for invalid values", async () => {
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
    }
  });

  const badState = await invoke(handler, {
    method: "GET",
    url: "/api/jobs?state=not_a_state"
  });
  assert.equal(badState.statusCode, 400);
  assert.equal(badState.json.error.code, "INVALID_INPUT");

  const badFrom = await invoke(handler, {
    method: "GET",
    url: "/api/jobs?from=not-a-date"
  });
  assert.equal(badFrom.statusCode, 400);
  assert.equal(badFrom.json.error.code, "INVALID_INPUT");

  const fromAfterTo = await invoke(handler, {
    method: "GET",
    url: "/api/jobs?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z"
  });
  assert.equal(fromAfterTo.statusCode, 400);
  assert.equal(fromAfterTo.json.error.code, "INVALID_INPUT");
});

test("catalog persistence restores host linkage and serves history after restart", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-fed-catalog-"));
  const catalogPath = path.join(tempDir, "catalog.json");

  try {
    const runtime = new FakeRuntime("h_alpha01");
    const handlerA = createFederationApiHandler({
      hosts: {
        h_alpha01: { runtime }
      },
      catalogStorePath: catalogPath
    });

    await registerEnrollAndHeartbeat(handlerA, "h_alpha01");
    const created = await invoke(handlerA, {
      method: "POST",
      url: "/api/jobs",
      body: JSON.stringify({
        hostId: "h_alpha01",
        jobId: "j_persist001",
        inputText: "Persist me"
      })
    });
    assert.equal(created.statusCode, 201);
    const persistedDeadlineMs = Date.now() + 5000;
    let persisted = false;
    while (Date.now() < persistedDeadlineMs) {
      if (fs.existsSync(catalogPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
          if (Array.isArray(parsed?.entries) && parsed.entries.some((entry) => entry?.jobId === "j_persist001")) {
            persisted = true;
            break;
          }
        } catch {
          // Keep polling until a valid catalog snapshot is available.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(persisted, true, "catalog entry should be persisted before restart");

    const handlerB = createFederationApiHandler({
      hosts: {
        h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
      },
      catalogStorePath: catalogPath
    });

    const loaded = await invoke(handlerB, {
      method: "GET",
      url: "/api/jobs/j_persist001"
    });
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.json.hostId, "h_alpha01");
    assert.equal(loaded.json.job.jobId, "j_persist001");
    assert.equal(loaded.json.catalog.jobId, "j_persist001");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("offline hosts block dispatch and start actions deterministically", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  let mockTime = Date.now();
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    },
    heartbeatDegradedMs: 5,
    heartbeatOfflineMs: 10,
    getNow: () => mockTime
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

  mockTime += 20;

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

test("reconcile includes routes even when job-route cache ttl has expired", async () => {
  const runtime = new FakeRuntime("h_alpha01");
  let mockTime = Date.now();
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime }
    },
    heartbeatDegradedMs: 5,
    heartbeatOfflineMs: 10,
    jobRouteCacheTtlMs: 5,
    getNow: () => mockTime
  });

  await registerEnrollAndHeartbeat(handler, "h_alpha01");
  const created = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_alpha01",
      jobId: "j_route_ttl001",
      inputText: "should still be reconciled after route ttl"
    })
  });
  assert.equal(created.statusCode, 201);

  mockTime += 20;

  const reconcile = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/reconcile",
    body: JSON.stringify({})
  });
  assert.equal(reconcile.statusCode, 200);
  assert.equal(
    reconcile.json.transitions.some((entry) => entry.jobId === "j_route_ttl001"),
    true
  );
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

test("dispatch to enrolled but unconfigured host returns HOST_NOT_READY as 503", async () => {
  const handler = createFederationApiHandler({
    hosts: {}
  });

  await registerEnrollAndHeartbeat(handler, "h_charlie03");
  const dispatch = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      hostId: "h_charlie03",
      inputText: "Attempt dispatch"
    })
  });

  assert.equal(dispatch.statusCode, 503);
  assert.equal(dispatch.json.error.code, "HOST_NOT_READY");
});

test("start route on unconfigured host returns HOST_NOT_READY instead of 500", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-fed-host-not-ready-"));
  const catalogPath = path.join(tempDir, "catalog.json");
  const nowIso = new Date().toISOString();
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: "run-catalog.v1",
    updatedAt: nowIso,
    entries: [
      {
        catalogVersion: "run-catalog.v1",
        jobId: "j_unconfigured001",
        hostId: "h_charlie03",
        state: JOB_STATES.QUEUED,
        timestamps: {
          createdAt: nowIso,
          updatedAt: nowIso
        },
        job: {
          jobId: "j_unconfigured001",
          hostId: "h_charlie03",
          state: JOB_STATES.QUEUED,
          timestamps: {
            createdAt: nowIso,
            updatedAt: nowIso
          }
        }
      }
    ]
  }), "utf8");

  try {
    const handler = createFederationApiHandler({
      hosts: {},
      catalogStorePath: catalogPath
    });

    await registerEnrollAndHeartbeat(handler, "h_charlie03");
    const response = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_unconfigured001/start",
      body: JSON.stringify({})
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json.error.code, "HOST_NOT_READY");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("malformed path encoding returns INVALID_INPUT", async () => {
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
    }
  });

  const response = await invoke(handler, {
    method: "GET",
    url: "/api/hosts/%E0%A4%A"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error.code, "INVALID_INPUT");
});

test("oversized request body is rejected early", async () => {
  const handler = createFederationApiHandler({
    hosts: {
      h_alpha01: { runtime: new FakeRuntime("h_alpha01") }
    }
  });

  const oversized = "x".repeat(5 * 1024 * 1024 + 1);
  const response = await invoke(handler, {
    method: "POST",
    url: "/api/hosts/register",
    body: JSON.stringify({
      hostId: "h_alpha01",
      displayName: oversized
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error.code, "INVALID_INPUT");
});
