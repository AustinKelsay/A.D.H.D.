import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createHostApiHandler } from "../src/server/host-api.js";
import { RuntimeError } from "../src/runtime/errors.js";

class FakeRuntime {
  constructor() {
    this.jobs = new Map();
    this.approvals = [];
    this.rejections = [];
    this.pending = [];
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
    const job = {
      jobId,
      hostId: "h_test",
      inputText,
      intake,
      state: "queued",
      delegationMode,
      intent,
      plan,
      delegationDecision,
      resultSummary: null,
      artifactPaths: [],
      policySnapshot,
      timestamps: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        endedAt: null
      }
    };
    this.jobs.set(jobId, job);
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
    job.state = "running";
    job.timestamps.startedAt = new Date().toISOString();
    return job;
  }

  async interruptJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    job.state = "cancelled";
    job.timestamps.endedAt = new Date().toISOString();
    return job;
  }

  approveRequest(requestId, result) {
    this.approvals.push({ requestId, result });
  }

  rejectRequest(requestId, message) {
    this.rejections.push({ requestId, message });
  }

  async retryJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    if (!["failed", "cancelled", "completed"].includes(job.state)) {
      throw new RuntimeError("JOB_NOT_TERMINAL", `Job is not terminal: ${jobId}`);
    }
    job.state = "queued";
    job.threadId = null;
    job.turnId = null;
    job.resultSummary = null;
    job.artifactPaths = [];
    job.timestamps.startedAt = null;
    job.timestamps.endedAt = null;
    return job;
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

  listPendingApprovals(jobId = null) {
    if (!jobId) {
      return [...this.pending];
    }
    return this.pending.filter((entry) => entry.jobId === jobId);
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

  let responseBody = "";
  const responseHeaders = {};
  let responseStatusCode = 200;

  let ended = false;
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

test("intent normalize route", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/normalize",
    body: JSON.stringify({
      inputText: "Refactor ./src/server/host-api.js and skip tests"
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.intent.contractVersion, "intent.v1");
  assert.equal(response.json.intent.workType, "refactor");
});

test("intake route accepts voice transcript and creates a job", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intake",
    body: JSON.stringify({
      jobId: "j_voice001",
      intake: {
        mode: "voice",
        transcript: "Fix bug in ./src/runtime/host-runtime.js",
        source: "microphone",
        language: "en-US",
        segments: [{ text: "Fix bug" }, { text: "host runtime" }]
      }
    })
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.job.jobId, "j_voice001");
  assert.equal(response.json.job.intake.mode, "voice");
  assert.equal(response.json.job.inputText, "Fix bug in ./src/runtime/host-runtime.js");
});

test("intent plan route enforces delegation policy fallback", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Open pull request and merge release",
      requestedMode: "multi_agent",
      delegationPolicy: {
        multiAgentKillSwitch: true
      },
      hostCapabilities: {
        multi_agent: true
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.plan.contractVersion, "plan.v1");
  assert.equal(response.json.plan.delegation.selectedMode, "fallback_workers");
  assert.equal(response.json.plan.delegation.reasonCode, "kill-switch");
});

test("intent plan route treats string capability false as missing multi-agent support", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Open pull request and merge release",
      requestedMode: "multi_agent",
      delegationPolicy: {
        multiAgentKillSwitch: false,
        allowMultiAgent: true
      },
      hostCapabilities: {
        multi_agent: "false"
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.plan.contractVersion, "plan.v1");
  assert.equal(response.json.plan.delegation.selectedMode, "fallback_workers");
  assert.equal(response.json.plan.delegation.reasonCode, "capability-missing");
});

test("intent plan route enforces host kill-switch even for client-provided plan", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getHostCapabilities: () => ({ multi_agent: true }),
    getDelegationPolicy: () => ({
      defaultMode: "multi_agent",
      allowMultiAgent: true,
      multiAgentKillSwitch: true
    })
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Open pull request and merge release",
      plan: {
        contractVersion: "plan.v1",
        intentContractVersion: "intent.v1",
        promptVersion: "conductor.v1",
        summary: "open pull request and merge release",
        workType: "git-release",
        target: ".",
        paths: [],
        constraints: [],
        hostConstraints: null,
        steps: [
          {
            id: "s1",
            title: "Do release work",
            acceptanceCriteria: "Release tasks are complete.",
            risk: "medium"
          }
        ],
        delegation: {
          requestedMode: "multi_agent",
          selectedMode: "multi_agent",
          reasonCode: "accepted",
          reason: "provided by client",
          killSwitchApplied: false,
          policy: {
            defaultMode: "multi_agent",
            allowMultiAgent: true,
            multiAgentKillSwitch: false
          },
          hostCapability: {
            multiAgent: true
          }
        },
        metadata: {
          source: "test"
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.plan.delegation.selectedMode, "fallback_workers");
  assert.equal(response.json.plan.delegation.killSwitchApplied, true);
});

test("intent plan route does not allow client capabilities to escalate host capabilities", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getHostCapabilities: () => ({ multi_agent: false })
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Open pull request and merge release",
      requestedMode: "multi_agent",
      delegationPolicy: {
        allowMultiAgent: true,
        multiAgentKillSwitch: false
      },
      hostCapabilities: {
        multi_agent: true
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.plan.delegation.selectedMode, "fallback_workers");
  assert.equal(response.json.plan.delegation.reasonCode, "capability-missing");
});

test("intent plan route returns 422 for invalid plan payload", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Refactor ./src/runtime/host-runtime.js",
      plan: {
        contractVersion: "plan.v1"
      }
    })
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json.error.code, "INVALID_PLAN");
});

test("intent plan route returns 400 for invalid delegationPolicy type", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Refactor ./src/runtime/host-runtime.js",
      delegationPolicy: "invalid"
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error.code, "INVALID_INPUT");
});

test("host default delegation kill switch cannot be bypassed per request", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getHostCapabilities: () => ({ multi_agent: true }),
    getDelegationPolicy: () => ({
      defaultMode: "multi_agent",
      allowMultiAgent: true,
      multiAgentKillSwitch: true
    })
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Open pull request and merge release",
      requestedMode: "multi_agent",
      delegationPolicy: {
        multiAgentKillSwitch: false
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.plan.delegation.selectedMode, "fallback_workers");
  assert.equal(response.json.plan.delegation.killSwitchApplied, true);
});

test("health route includes effective host delegation policy", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getDelegationPolicy: () => ({
      defaultMode: "multi_agent",
      allowMultiAgent: "false",
      multiAgentKillSwitch: "false"
    })
  });

  const response = await invoke(handler, {
    method: "GET",
    url: "/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.delegationPolicy.defaultMode, "multi_agent");
  assert.equal(response.json.delegationPolicy.allowMultiAgent, false);
  assert.equal(response.json.delegationPolicy.multiAgentKillSwitch, false);
});

test("create/list/get job routes", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const created = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: JSON.stringify({
      jobId: "j_api001",
      inputText: "Implement X"
    })
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json.ok, true);
  assert.equal(created.json.job.jobId, "j_api001");
  assert.equal(created.json.job.intent.contractVersion, "intent.v1");
  assert.equal(created.json.job.plan.contractVersion, "plan.v1");
  assert.equal(created.json.job.delegationDecision.selectedMode, "fallback_workers");
  assert.equal(created.json.job.intake.mode, "text");

  const listed = await invoke(handler, {
    method: "GET",
    url: "/api/jobs"
  });

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json.jobs.length, 1);

  const got = await invoke(handler, {
    method: "GET",
    url: "/api/jobs/j_api001"
  });

  assert.equal(got.statusCode, 200);
  assert.equal(got.json.job.jobId, "j_api001");
});

test("start and interrupt routes", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  runtime.createJob({ jobId: "j_api002", inputText: "Implement Y" });

  const started = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_api002/start",
    body: JSON.stringify({})
  });

  assert.equal(started.statusCode, 200);
  assert.equal(started.json.job.state, "running");

  const interrupted = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_api002/interrupt",
    body: JSON.stringify({})
  });

  assert.equal(interrupted.statusCode, 200);
  assert.equal(interrupted.json.job.state, "cancelled");
});

test("retry route moves terminal job back to queued", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  runtime.createJob({ jobId: "j_retry001", inputText: "Implement Y" });
  runtime.jobs.get("j_retry001").state = "cancelled";
  runtime.jobs.get("j_retry001").timestamps.endedAt = new Date().toISOString();

  const retried = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_retry001/retry",
    body: JSON.stringify({})
  });

  assert.equal(retried.statusCode, 200);
  assert.equal(retried.json.job.state, "queued");
  assert.equal(retried.json.autoStarted, false);
});

test("live route returns job with pending approvals for polling clients", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  runtime.createJob({ jobId: "j_live001", inputText: "Implement Y" });
  runtime.pending.push({ requestId: 91, jobId: "j_live001", method: "approval/request" });

  const live = await invoke(handler, {
    method: "GET",
    url: "/api/jobs/j_live001/live"
  });

  assert.equal(live.statusCode, 200);
  assert.equal(live.json.job.jobId, "j_live001");
  assert.equal(live.json.pendingApprovals.length, 1);
  assert.equal(live.json.pendingApprovals[0].requestId, 91);
});

test("result route returns persisted summary and artifacts", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  runtime.createJob({ jobId: "j_result001", inputText: "Implement Y" });
  runtime.jobs.get("j_result001").resultSummary = "All done";
  runtime.jobs.get("j_result001").artifactPaths = ["artifacts/summary.md"];

  const result = await invoke(handler, {
    method: "GET",
    url: "/api/jobs/j_result001/result"
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.result.resultSummary, "All done");
  assert.deepEqual(result.json.result.artifactPaths, ["artifacts/summary.md"]);
});

test("returns 404 when start job does not exist", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const started = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_missing/start",
    body: JSON.stringify({})
  });

  assert.equal(started.statusCode, 404);
  assert.equal(started.json.error.code, "JOB_NOT_FOUND");
});

test("returns 503 when runtime is not ready for start/interrupt", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    isRuntimeReady: () => false,
    getRuntimeStatus: () => ({
      ready: false,
      error: { code: "INIT_FAILED", message: "init failed" }
    })
  });
  runtime.createJob({ jobId: "j_api003", inputText: "Implement Z" });

  const started = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_api003/start",
    body: JSON.stringify({})
  });

  assert.equal(started.statusCode, 503);
  assert.equal(started.json.error.code, "RUNTIME_NOT_READY");

  const interrupted = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_api003/interrupt",
    body: JSON.stringify({})
  });

  assert.equal(interrupted.statusCode, 503);
  assert.equal(interrupted.json.error.code, "RUNTIME_NOT_READY");
});

test("approval routes call runtime approve/reject", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const approved = await invoke(handler, {
    method: "POST",
    url: "/api/approvals/77/approve",
    body: JSON.stringify({ result: { approved: true } })
  });

  assert.equal(approved.statusCode, 202);
  assert.equal(runtime.approvals.length, 1);
  assert.equal(runtime.approvals[0].requestId, 77);

  const rejected = await invoke(handler, {
    method: "POST",
    url: "/api/approvals/77/reject",
    body: JSON.stringify({ message: "deny" })
  });

  assert.equal(rejected.statusCode, 202);
  assert.equal(runtime.rejections.length, 1);
  assert.equal(runtime.rejections[0].message, "deny");
});

test("returns 400 for invalid JSON", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/jobs",
    body: "{"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error.code, "INVALID_JSON");
});
