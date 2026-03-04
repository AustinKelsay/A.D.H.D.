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
  }

  createJob({ jobId, inputText, delegationMode = "fallback_workers", policySnapshot = null }) {
    const job = {
      jobId,
      hostId: "h_test",
      inputText,
      state: "queued",
      delegationMode,
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
