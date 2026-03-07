import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

import { createHostApiHandler } from "../src/server/host-api.js";
import { RuntimeError } from "../src/runtime/errors.js";
import { JOB_STATES } from "../src/runtime/state-machine.js";

class FakeRuntime extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.approvals = [];
    this.rejections = [];
    this.pending = [];
    this.startCalls = [];
    this.store = new EventEmitter();
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
    this.store.emit("created", structuredClone(job));
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  listJobs() {
    return [...this.jobs.values()];
  }

  async startJob(jobId, startParams = {}) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    this.startCalls.push({
      jobId,
      startParams: structuredClone(startParams)
    });
    const previousState = job.state;
    job.state = "running";
    job.timestamps.startedAt = new Date().toISOString();
    this.store.emit("transition", {
      jobId,
      from: previousState,
      to: job.state,
      reason: "start",
      at: job.timestamps.startedAt
    });
    this.store.emit("updated", structuredClone(job));
    return job;
  }

  async interruptJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    const previousState = job.state;
    job.state = "cancelled";
    job.timestamps.endedAt = new Date().toISOString();
    this.store.emit("transition", {
      jobId,
      from: previousState,
      to: job.state,
      reason: "interrupt",
      at: job.timestamps.endedAt
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

  async retryJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new RuntimeError("JOB_NOT_FOUND", `Job not found: ${jobId}`);
    }
    if (![JOB_STATES.FAILED, JOB_STATES.CANCELLED, JOB_STATES.COMPLETED].includes(job.state)) {
      throw new RuntimeError("JOB_NOT_TERMINAL", `Job is not terminal: ${jobId}`);
    }
    const previousState = job.state;
    job.state = JOB_STATES.QUEUED;
    job.hostJobId = null;
    job.threadId = null;
    job.turnId = null;
    job.resultSummary = null;
    job.artifactPaths = [];
    job.timestamps.startedAt = null;
    job.timestamps.endedAt = null;
    this.store.emit("transition", {
      jobId,
      from: previousState,
      to: job.state,
      reason: "retry",
      at: new Date().toISOString()
    });
    this.store.emit("updated", structuredClone(job));
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

async function createMobileSession(handler, { deviceLabel = "test-phone" } = {}) {
  const started = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/pairing/start",
    body: JSON.stringify({ deviceLabel })
  });
  assert.equal(started.statusCode, 201);
  assert.equal(started.json.ok, true);
  assert.equal(typeof started.json.pairing.pairingCode, "string");

  const completed = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/pairing/complete",
    body: JSON.stringify({
      pairingCode: started.json.pairing.pairingCode,
      deviceLabel
    }),
    headers: {
      "user-agent": "host-api-test"
    }
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.json.ok, true);
  assert.equal(typeof completed.json.token, "string");
  assert.equal("token" in completed.json.session, false);

  return {
    token: completed.json.token,
    pairingCode: started.json.pairing.pairingCode
  };
}

async function waitForCondition(predicate, { timeout = 2000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Timed out waiting for condition");
}

async function waitForExists(filePath, options) {
  return waitForCondition(() => fs.existsSync(filePath), options);
}

async function waitForNotExists(filePath, options) {
  return waitForCondition(() => !fs.existsSync(filePath), options);
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

test("intake route supports ASR segments-only payloads", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intake",
    body: JSON.stringify({
      jobId: "j_voice_segments",
      intake: {
        source: "asr-provider",
        language: "en-US",
        segments: [
          { text: "Refactor" },
          { alternatives: [{ transcript: "./src/server/host-api.js" }] },
          "carefully"
        ]
      }
    })
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.job.jobId, "j_voice_segments");
  assert.equal(response.json.job.intake.mode, "voice");
  assert.equal(response.json.job.intake.segmentCount, 3);
  assert.equal(response.json.job.inputText, "Refactor ./src/server/host-api.js carefully");
});

test("intake route supports top-level transcript fallback", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intake",
    body: JSON.stringify({
      jobId: "j_voice_top_level",
      transcript: "Please add tests for ./src/runtime/host-runtime.js"
    })
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.job.jobId, "j_voice_top_level");
  assert.equal(response.json.job.intake.mode, "text");
  assert.equal(response.json.job.inputText, "Please add tests for ./src/runtime/host-runtime.js");
});

test("intake route does not classify text-only payloads as voice and sanitizes source", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intake",
    body: JSON.stringify({
      jobId: "j_text_only_intake",
      intake: {
        mode: "voice",
        text: "Fix tests in ./test/host-api.test.js",
        source: "   ",
        language: "en-US"
      }
    })
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.job.jobId, "j_text_only_intake");
  assert.equal(response.json.job.intake.mode, "text");
  assert.equal(response.json.job.intake.source, "text");
  assert.equal(response.json.job.inputText, "Fix tests in ./test/host-api.test.js");
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
  runtime.getHostCapabilities = () => ({ multi_agent: "false" });
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getHostCapabilities: () => runtime.getHostCapabilities()
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Open pull request and merge release",
      requestedMode: "multi_agent",
      delegationPolicy: {
        multiAgentKillSwitch: false,
        allowMultiAgent: true
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.plan.contractVersion, "plan.v1");
  assert.equal(response.json.plan.delegation.selectedMode, "fallback_workers");
  assert.equal(response.json.plan.delegation.reasonCode, "capability-missing");
});

test("intent plan route treats unknown capability string as default false", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getHostCapabilities: () => ({ multi_agent: "disabled" })
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
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.plan.delegation.selectedMode, "fallback_workers");
  assert.equal(response.json.plan.delegation.reasonCode, "capability-missing");
});

test("intent plan route returns INVALID_CONFIG when host capabilities are not plain objects", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getHostCapabilities: () => []
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Open pull request and merge release"
    })
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json.error.code, "INVALID_CONFIG");
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

test("unknown kill-switch string in host policy falls back to default false", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getHostCapabilities: () => ({ multi_agent: true }),
    getDelegationPolicy: () => ({
      defaultMode: "multi_agent",
      allowMultiAgent: true,
      multiAgentKillSwitch: "disabled"
    })
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Open pull request and merge release",
      requestedMode: "multi_agent"
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.plan.delegation.selectedMode, "multi_agent");
  assert.equal(response.json.plan.delegation.killSwitchApplied, false);
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
  assert.equal(response.json.workflow.enabled, false);
  assert.equal(response.json.mobile.enabled, true);
});

test("health route exposes workflow status/preflight when configured", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getWorkflowStatus: () => ({
      path: "/tmp/WORKFLOW.md",
      loaded: true
    }),
    validateWorkflowPreflight: () => ({
      ok: false,
      error: {
        code: "WORKFLOW_INVALID",
        message: "workflow invalid",
        details: {
          field: "codex.command"
        }
      }
    })
  });

  const response = await invoke(handler, {
    method: "GET",
    url: "/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.workflow.enabled, true);
  assert.equal(response.json.workflow.status.loaded, true);
  assert.equal(response.json.workflow.preflight.ok, false);
  assert.equal(response.json.workflow.preflight.error.code, "WORKFLOW_INVALID");
});

test("workflow refresh route reports refresh outcomes and metrics", async () => {
  const runtime = new FakeRuntime();
  let refreshCalls = 0;
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getWorkflowStatus: () => ({
      path: "/tmp/WORKFLOW.md",
      loaded: true,
      contentHash: "abc123"
    }),
    validateWorkflowPreflight: () => ({ ok: true }),
    refreshWorkflow: async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) {
        return {
          ok: true,
          changed: true
        };
      }
      return {
        ok: false,
        error: {
          code: "WORKFLOW_PARSE_ERROR",
          message: "bad front matter"
        }
      };
    }
  });

  const refreshedOk = await invoke(handler, {
    method: "POST",
    url: "/api/workflow/refresh",
    body: JSON.stringify({})
  });
  assert.equal(refreshedOk.statusCode, 200);
  assert.equal(refreshedOk.json.ok, true);
  assert.equal(refreshedOk.json.refresh.changed, true);

  const refreshedFail = await invoke(handler, {
    method: "POST",
    url: "/api/workflow/refresh",
    body: JSON.stringify({})
  });
  assert.equal(refreshedFail.statusCode, 200);
  assert.equal(refreshedFail.json.ok, false);
  assert.equal(refreshedFail.json.refresh.error.code, "WORKFLOW_PARSE_ERROR");

  const metrics = await invoke(handler, {
    method: "GET",
    url: "/metrics"
  });
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.json.metrics.workflowRefresh.attempts, 2);
  assert.equal(metrics.json.metrics.workflowRefresh.successes, 1);
  assert.equal(metrics.json.metrics.workflowRefresh.failures, 1);
});

test("workflow preflight blocks planning and start routes", async () => {
  const runtime = new FakeRuntime();
  runtime.createJob({ jobId: "j_workflow_block", inputText: "Implement Z" });
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    validateWorkflowPreflight: () => ({
      ok: false,
      error: {
        code: "WORKFLOW_MISSING",
        message: "workflow file missing"
      }
    })
  });

  const planned = await invoke(handler, {
    method: "POST",
    url: "/api/intent/plan",
    body: JSON.stringify({
      inputText: "Plan this work"
    })
  });

  assert.equal(planned.statusCode, 503);
  assert.equal(planned.json.error.code, "WORKFLOW_MISSING");

  const started = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_workflow_block/start",
    body: JSON.stringify({})
  });

  assert.equal(started.statusCode, 503);
  assert.equal(started.json.error.code, "WORKFLOW_MISSING");

  const metrics = await invoke(handler, {
    method: "GET",
    url: "/metrics"
  });
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.json.metrics.workflowPreflightBlocks, 2);
});

test("workflow hooks run on create, start, terminal completion, and retry cleanup", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-hooks-"));
  const workspaceRoot = path.join(tempDir, "workspaces");
  const markerDir = path.join(tempDir, "markers");
  fs.mkdirSync(markerDir, { recursive: true });

  try {
    const runtime = new FakeRuntime();
    const handler = createHostApiHandler({
      runtime,
      hostId: "h_test",
      getWorkflowWorkspacePolicy: () => ({
        root: "workspaces",
        rootPath: workspaceRoot,
        requirePathContainment: true
      }),
      getWorkflowHookPolicy: () => ({
        timeoutMs: 500,
        afterCreate: `node -e 'require("node:fs").writeFileSync(process.env.ADHD_WORKSPACE_PATH + "/after_create.txt", process.env.ADHD_HOOK_NAME)'`,
        beforeRun: `node -e 'require("node:fs").writeFileSync(process.env.ADHD_WORKSPACE_PATH + "/before_run.txt", process.env.ADHD_HOOK_NAME)'`,
        afterRun: `node -e 'require("node:fs").writeFileSync(${JSON.stringify(path.join(markerDir, "after_run.txt"))}, process.env.ADHD_JOB_ID)'`,
        beforeRemove: `node -e 'require("node:fs").writeFileSync(${JSON.stringify(path.join(markerDir, "before_remove.txt"))}, process.env.ADHD_JOB_ID)'`
      })
    });

    const created = await invoke(handler, {
      method: "POST",
      url: "/api/jobs",
      body: JSON.stringify({
        jobId: "j_hook001",
        inputText: "Implement hook lifecycle"
      })
    });
    assert.equal(created.statusCode, 201);

    const workspacePath = path.join(workspaceRoot, "j_hook001");
    assert.equal(fs.existsSync(path.join(workspacePath, "after_create.txt")), true);

    const started = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook001/start",
      body: JSON.stringify({})
    });
    assert.equal(started.statusCode, 200);
    assert.equal(fs.existsSync(path.join(workspacePath, "before_run.txt")), true);

    const interrupted = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook001/interrupt",
      body: JSON.stringify({})
    });
    assert.equal(interrupted.statusCode, 200);

    const retried = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook001/retry",
      body: JSON.stringify({})
    });
    assert.equal(retried.statusCode, 200);

    await waitForExists(path.join(markerDir, "after_run.txt"));
    await waitForExists(path.join(markerDir, "before_remove.txt"));
    await waitForNotExists(workspacePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow afterRun hooks still run when mobile control is disabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-hook-afterrun-"));
  const markerPath = path.join(tempDir, "after_run.txt");
  try {
    const runtime = new FakeRuntime();
    const handler = createHostApiHandler({
      runtime,
      hostId: "h_test",
      getMobileConfig: () => ({ enabled: false }),
      getWorkflowWorkspacePolicy: () => ({
        root: "workspaces",
        rootPath: path.join(tempDir, "workspaces"),
        requirePathContainment: true
      }),
      getWorkflowHookPolicy: () => ({
        timeoutMs: 500,
        afterCreate: null,
        beforeRun: null,
        afterRun: `node -e 'require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, process.env.ADHD_JOB_ID)'`,
        beforeRemove: null
      })
    });

    const created = await invoke(handler, {
      method: "POST",
      url: "/api/jobs",
      body: JSON.stringify({
        jobId: "j_hook_afterrun",
        inputText: "Finish work"
      })
    });
    assert.equal(created.statusCode, 201);

    const started = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook_afterrun/start",
      body: JSON.stringify({})
    });
    assert.equal(started.statusCode, 200);

    const interrupted = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook_afterrun/interrupt",
      body: JSON.stringify({})
    });
    assert.equal(interrupted.statusCode, 200);

    await waitForExists(markerPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow retry cleanup runs only after a successful retry", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-hook-retry-order-"));
  const markerPath = path.join(tempDir, "before_remove.txt");
  try {
    const runtime = new FakeRuntime();
    const handler = createHostApiHandler({
      runtime,
      hostId: "h_test",
      getWorkflowWorkspacePolicy: () => ({
        root: "workspaces",
        rootPath: path.join(tempDir, "workspaces"),
        requirePathContainment: true
      }),
      getWorkflowHookPolicy: () => ({
        timeoutMs: 500,
        afterCreate: `node -e 'require("node:fs").mkdirSync(process.env.ADHD_WORKSPACE_PATH, { recursive: true })'`,
        beforeRun: null,
        afterRun: null,
        beforeRemove: `node -e 'require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, process.env.ADHD_JOB_ID)'`
      })
    });

    const created = await invoke(handler, {
      method: "POST",
      url: "/api/jobs",
      body: JSON.stringify({
        jobId: "j_hook_retry_order",
        inputText: "Retry safely"
      })
    });
    assert.equal(created.statusCode, 201);

    const workspacePath = path.join(tempDir, "workspaces", "j_hook_retry_order");
    const originalRetryJob = runtime.retryJob.bind(runtime);
    runtime.retryJob = async () => {
      throw new RuntimeError("JOB_NOT_TERMINAL", "retry blocked");
    };

    const failedRetry = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook_retry_order/retry",
      body: JSON.stringify({})
    });
    assert.equal(failedRetry.statusCode, 409);
    assert.equal(fs.existsSync(markerPath), false);
    assert.equal(fs.existsSync(workspacePath), true);

    runtime.retryJob = originalRetryJob;
    const interrupted = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook_retry_order/interrupt",
      body: JSON.stringify({})
    });
    assert.equal(interrupted.statusCode, 200);

    const successfulRetry = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook_retry_order/retry",
      body: JSON.stringify({})
    });
    assert.equal(successfulRetry.statusCode, 200);
    await waitForExists(markerPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow hooks fail closed on timeout during start", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-hook-timeout-"));
  try {
    const runtime = new FakeRuntime();
    runtime.createJob({ jobId: "j_hook_timeout", inputText: "Start job" });
    const handler = createHostApiHandler({
      runtime,
      hostId: "h_test",
      getWorkflowWorkspacePolicy: () => ({
        root: "workspaces",
        rootPath: path.join(tempDir, "workspaces"),
        requirePathContainment: true
      }),
      getWorkflowHookPolicy: () => ({
        timeoutMs: 50,
        afterCreate: null,
        beforeRun: `node -e 'setTimeout(() => {}, 250)'`,
        afterRun: null,
        beforeRemove: null
      })
    });

    const started = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook_timeout/start",
      body: JSON.stringify({})
    });
    assert.equal(started.statusCode, 503);
    assert.equal(started.json.error.code, "WORKFLOW_HOOK_FAILED");

    const metrics = await invoke(handler, {
      method: "GET",
      url: "/metrics"
    });
    assert.equal(metrics.statusCode, 200);
    assert.equal(metrics.json.metrics.workflowHooks.failures >= 1, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow hook timeout escalates to SIGKILL when SIGTERM is ignored", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-hook-timeout-kill-"));
  try {
    const runtime = new FakeRuntime();
    runtime.createJob({ jobId: "j_hook_timeout_kill", inputText: "Start job" });
    const handler = createHostApiHandler({
      runtime,
      hostId: "h_test",
      getWorkflowWorkspacePolicy: () => ({
        root: "workspaces",
        rootPath: path.join(tempDir, "workspaces"),
        requirePathContainment: true
      }),
      getWorkflowHookPolicy: () => ({
        timeoutMs: 50,
        afterCreate: null,
        beforeRun: "node -e 'process.on(\"SIGTERM\", () => {}); setInterval(() => {}, 1000)'",
        afterRun: null,
        beforeRemove: null
      })
    });

    const startedAtMs = Date.now();
    const started = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook_timeout_kill/start",
      body: JSON.stringify({})
    });
    const elapsedMs = Date.now() - startedAtMs;

    assert.equal(started.statusCode, 503);
    assert.equal(started.json.error.code, "WORKFLOW_HOOK_FAILED");
    assert.equal(started.json.error.details.timedOut, true);
    assert.equal(elapsedMs < 1500, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow hook failures redact secrets and truncate output", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-hook-sanitize-"));
  try {
    const runtime = new FakeRuntime();
    runtime.createJob({ jobId: "j_hook_sanitize", inputText: "Start job" });
    const handler = createHostApiHandler({
      runtime,
      hostId: "h_test",
      getWorkflowWorkspacePolicy: () => ({
        root: "workspaces",
        rootPath: path.join(tempDir, "workspaces"),
        requirePathContainment: true
      }),
      getWorkflowHookPolicy: () => ({
        timeoutMs: 500,
        afterCreate: null,
        beforeRun: "node -e \"process.stdout.write('HEADMARK\\n' + 'x'.repeat(5000) + 'TAILMARK\\n' + 'y'.repeat(65000) + '\\nsecret=supersecret'); process.stderr.write('Bearer verysecret'); process.exit(7)\"",
        afterRun: null,
        beforeRemove: null
      })
    });

    const started = await invoke(handler, {
      method: "POST",
      url: "/api/jobs/j_hook_sanitize/start",
      body: JSON.stringify({})
    });
    assert.equal(started.statusCode, 503);
    assert.equal(started.json.error.code, "WORKFLOW_HOOK_FAILED");
    assert.equal(started.json.error.details.stdout.length <= 4014, true);
    assert.match(started.json.error.details.stdout, /\.\.\.\[truncated\]$/);
    assert.match(started.json.error.details.stderr, /Bearer \[REDACTED\]/);
    assert.doesNotMatch(started.json.error.details.stderr, /verysecret/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mobile routes return 404 when mobile control is disabled (boolean or string)", async () => {
  for (const enabledValue of [false, "false"]) {
    const runtime = new FakeRuntime();
    const handler = createHostApiHandler({
      runtime,
      hostId: "h_test",
      getMobileConfig: () => ({ enabled: enabledValue })
    });

    const response = await invoke(handler, {
      method: "POST",
      url: "/api/mobile/pairing/start",
      body: JSON.stringify({})
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json.error.code, "MOBILE_DISABLED");
  }
});

test("mobile routes require bearer token after pairing endpoints", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  const response = await invoke(handler, {
    method: "GET",
    url: "/api/mobile/session"
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json.error.code, "MOBILE_UNAUTHORIZED");
});

test("mobile pairing/session lifecycle works end-to-end", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  const { token } = await createMobileSession(handler, { deviceLabel: "pixel-test" });

  const session = await invoke(handler, {
    method: "GET",
    url: "/api/mobile/session",
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  assert.equal(session.statusCode, 200);
  assert.equal(session.json.ok, true);
  assert.equal(session.json.session.deviceLabel, "pixel-test");
  assert.equal("token" in session.json.session, false);

  const revoked = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/session/revoke",
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  assert.equal(revoked.statusCode, 202);
  assert.equal(revoked.json.revoked, true);

  const afterRevoke = await invoke(handler, {
    method: "GET",
    url: "/api/mobile/session",
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  assert.equal(afterRevoke.statusCode, 401);
  assert.equal(afterRevoke.json.error.code, "MOBILE_UNAUTHORIZED");
});

test("mobile pairing start enforces max pending pairing capacity", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getMobileConfig: () => ({
      maxPendingPairings: 1,
      pairingTtlMs: 60 * 1000
    })
  });

  const firstStart = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/pairing/start",
    body: JSON.stringify({ deviceLabel: "first" })
  });
  assert.equal(firstStart.statusCode, 201);

  const secondStart = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/pairing/start",
    body: JSON.stringify({ deviceLabel: "second" })
  });
  assert.equal(secondStart.statusCode, 201);

  const firstComplete = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/pairing/complete",
    body: JSON.stringify({ pairingCode: firstStart.json.pairing.pairingCode })
  });
  assert.equal(firstComplete.statusCode, 401);
  assert.equal(firstComplete.json.error.code, "MOBILE_PAIRING_INVALID");

  const secondComplete = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/pairing/complete",
    body: JSON.stringify({ pairingCode: secondStart.json.pairing.pairingCode })
  });
  assert.equal(secondComplete.statusCode, 200);
});

test("mobile API proxies authenticated actions to canonical job routes", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  const { token } = await createMobileSession(handler);
  const authHeaders = {
    authorization: `Bearer ${token}`
  };

  const created = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/jobs",
    body: JSON.stringify({
      jobId: "j_mobile001",
      inputText: "Implement X via mobile"
    }),
    headers: authHeaders
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json.job.jobId, "j_mobile001");

  const started = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/jobs/j_mobile001/start",
    body: JSON.stringify({}),
    headers: authHeaders
  });

  assert.equal(started.statusCode, 200);
  assert.equal(started.json.job.state, JOB_STATES.RUNNING);

  const metrics = await invoke(handler, {
    method: "GET",
    url: "/metrics"
  });
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.json.metrics.requestsTotal, 5);
});

test("mobile events endpoint supports replay cursors", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  const { token } = await createMobileSession(handler);
  const authHeaders = {
    authorization: `Bearer ${token}`
  };

  const firstRead = await invoke(handler, {
    method: "GET",
    url: "/api/mobile/events?after=0&limit=10",
    headers: authHeaders
  });

  assert.equal(firstRead.statusCode, 200);
  assert.equal(firstRead.json.ok, true);
  assert.equal(Array.isArray(firstRead.json.events), true);
  assert.equal(firstRead.json.events.length >= 2, true);
  const afterId = firstRead.json.nextAfterId;

  const created = await invoke(handler, {
    method: "POST",
    url: "/api/mobile/jobs",
    body: JSON.stringify({
      jobId: "j_mobile_evt001",
      inputText: "Create event replay checkpoint"
    }),
    headers: authHeaders
  });
  assert.equal(created.statusCode, 201);

  const secondRead = await invoke(handler, {
    method: "GET",
    url: `/api/mobile/events?after=${afterId}&limit=20`,
    headers: authHeaders
  });

  assert.equal(secondRead.statusCode, 200);
  assert.equal(secondRead.json.count >= 1, true);
  assert.equal(secondRead.json.events.some((event) => event.jobId === "j_mobile_evt001"), true);
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
  assert.equal(listed.json.pagination.total, 1);

  const got = await invoke(handler, {
    method: "GET",
    url: "/api/jobs/j_api001"
  });

  assert.equal(got.statusCode, 200);
  assert.equal(got.json.job.jobId, "j_api001");
});

test("list jobs supports filtering and pagination", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });

  runtime.createJob({ jobId: "j_list001", inputText: "Fix crash bug in parser", delegationMode: "fallback_workers" });
  runtime.createJob({ jobId: "j_list002", inputText: "Write docs for parser", delegationMode: "fallback_workers" });
  runtime.createJob({ jobId: "j_list003", inputText: "Open PR for parser fix", delegationMode: "multi_agent" });
  runtime.jobs.get("j_list001").state = "running";
  runtime.jobs.get("j_list002").state = "completed";
  runtime.jobs.get("j_list003").state = "running";

  const filtered = await invoke(handler, {
    method: "GET",
    url: "/api/jobs?state=running&delegationMode=fallback_workers&q=bug&limit=1&offset=0"
  });

  assert.equal(filtered.statusCode, 200);
  assert.equal(filtered.json.jobs.length, 1);
  assert.equal(filtered.json.jobs[0].jobId, "j_list001");
  assert.equal(filtered.json.pagination.total, 1);
  assert.equal(filtered.json.pagination.returned, 1);
  assert.equal(filtered.json.pagination.hasMore, false);
});

test("list jobs returns 400 for invalid pagination input", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  runtime.createJob({ jobId: "j_list_bad", inputText: "Anything" });

  const response = await invoke(handler, {
    method: "GET",
    url: "/api/jobs?limit=0"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error.code, "INVALID_INPUT");
});

test("list jobs returns 400 for non-integer pagination input", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  runtime.createJob({ jobId: "j_list_non_integer", inputText: "Anything" });

  const response = await invoke(handler, {
    method: "GET",
    url: "/api/jobs?limit=10abc"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error.code, "INVALID_INPUT");
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

test("start route merges workflow defaults into start params", async () => {
  const runtime = new FakeRuntime();
  runtime.createJob({ jobId: "j_start_defaults", inputText: "Implement Y" });
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getWorkflowStartDefaults: () => ({
      threadStartParams: {
        approvalPolicy: "never",
        sandbox: "workspace-write"
      },
      turnStartParams: {
        approvalPolicy: "never",
        sandboxPolicy: { type: "workspaceWrite" }
      }
    })
  });

  const started = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_start_defaults/start",
    body: JSON.stringify({
      threadStartParams: {
        approvalPolicy: "on-failure"
      },
      turnStartParams: {
        temperature: 0
      }
    })
  });

  assert.equal(started.statusCode, 200);
  assert.equal(runtime.startCalls.length, 1);
  assert.deepEqual(runtime.startCalls[0].startParams, {
    threadStartParams: {
      approvalPolicy: "on-failure",
      sandbox: "workspace-write"
    },
    turnStartParams: {
      approvalPolicy: "never",
      sandboxPolicy: { type: "workspaceWrite" },
      temperature: 0
    }
  });
});

test("intake autoStart merges workflow defaults into start params", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({
    runtime,
    hostId: "h_test",
    getWorkflowStartDefaults: () => ({
      threadStartParams: {
        approvalPolicy: "never",
        sandbox: "workspace-write"
      },
      turnStartParams: {
        approvalPolicy: "never"
      }
    })
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/intake",
    body: JSON.stringify({
      jobId: "j_intake_defaults",
      inputText: "Implement Y",
      autoStart: true,
      startParams: {
        turnStartParams: {
          temperature: 0
        }
      }
    })
  });

  assert.equal(response.statusCode, 201);
  assert.equal(runtime.startCalls.length, 1);
  assert.deepEqual(runtime.startCalls[0].startParams, {
    threadStartParams: {
      approvalPolicy: "never",
      sandbox: "workspace-write"
    },
    turnStartParams: {
      approvalPolicy: "never",
      temperature: 0
    }
  });
});

test("retry route moves terminal job back to queued", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  runtime.createJob({ jobId: "j_retry001", inputText: "Implement Y" });
  const terminalJob = runtime.jobs.get("j_retry001");
  terminalJob.state = JOB_STATES.CANCELLED;
  terminalJob.hostJobId = "host_prev_001";
  terminalJob.threadId = "thread_prev_001";
  terminalJob.turnId = "turn_prev_001";
  terminalJob.resultSummary = "old summary";
  terminalJob.artifactPaths = ["artifacts/old-summary.md"];
  terminalJob.timestamps.startedAt = new Date(Date.now() - 1000).toISOString();
  terminalJob.timestamps.endedAt = new Date().toISOString();

  const retried = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_retry001/retry",
    body: JSON.stringify({})
  });

  assert.equal(retried.statusCode, 200);
  assert.equal(retried.json.job.state, JOB_STATES.QUEUED);
  assert.equal(retried.json.autoStarted, false);
  assert.equal(retried.json.job.hostJobId, null);
  assert.equal(retried.json.job.threadId, null);
  assert.equal(retried.json.job.turnId, null);
  assert.equal(retried.json.job.resultSummary, null);
  assert.deepEqual(retried.json.job.artifactPaths, []);
  assert.equal(retried.json.job.timestamps.startedAt, null);
  assert.equal(retried.json.job.timestamps.endedAt, null);
});

test("retry route with startNow true auto-starts retried job", async () => {
  const runtime = new FakeRuntime();
  const handler = createHostApiHandler({ runtime, hostId: "h_test" });
  runtime.createJob({ jobId: "j_retry_start001", inputText: "Implement Y" });
  runtime.jobs.get("j_retry_start001").state = JOB_STATES.CANCELLED;
  runtime.jobs.get("j_retry_start001").timestamps.endedAt = new Date().toISOString();

  const retried = await invoke(handler, {
    method: "POST",
    url: "/api/jobs/j_retry_start001/retry",
    body: JSON.stringify({ startNow: true })
  });

  assert.equal(retried.statusCode, 200);
  assert.equal(retried.json.autoStarted, true);
  assert.equal(retried.json.job.state, JOB_STATES.RUNNING);
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
