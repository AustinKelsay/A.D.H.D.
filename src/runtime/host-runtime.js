import { EventEmitter } from "node:events";
import { RuntimeError, assert } from "./errors.js";
import { SessionStore } from "./session-store.js";
import { JOB_STATES } from "./state-machine.js";

const TERMINAL_STATES = new Set([JOB_STATES.COMPLETED, JOB_STATES.FAILED, JOB_STATES.CANCELLED]);

function extractThreadId(payload = {}) {
  return payload?.thread?.id || payload?.threadId || payload?.thread_id || null;
}

function extractTurnId(payload = {}) {
  return payload?.turn?.id || payload?.turnId || payload?.turn_id || null;
}

function extractRequestThreadId(message = {}) {
  return message?.params?.threadId || message?.params?.thread_id || null;
}

export class HostRuntime extends EventEmitter {
  constructor({ adapter, hostId = "h_local", store = new SessionStore() } = {}) {
    super();

    assert(adapter, "MISSING_ADAPTER", "adapter is required");
    this.adapter = adapter;
    this.hostId = hostId;
    this.store = store;

    this.pendingApprovals = new Map();

    this.adapter.on("notification", (message) => this.onNotification(message));
    this.adapter.on("approvalRequest", (message) => this.onApprovalRequest(message));
    this.adapter.on("decodeError", (error) => this.emit("decodeError", error));
    this.adapter.on("error", (error) => this.emit("error", error));
  }

  async initialize() {
    const result = await this.adapter.initialize({
      clientInfo: {
        name: "adhd-host-runtime",
        version: "0.1.0"
      },
      capabilities: {}
    });
    this.adapter.initialized();
    return result;
  }

  createJob({
    jobId,
    inputText,
    delegationMode = "fallback_workers",
    intent = null,
    plan = null,
    delegationDecision = null,
    policySnapshot = {
      approvalPolicy: "on-request",
      sandboxPolicy: "workspaceWrite",
      maxWorkers: 1,
      timeoutMs: 600000
    }
  }) {
    return this.store.createJob({
      jobId,
      hostId: this.hostId,
      inputText,
      delegationMode,
      intent,
      plan,
      delegationDecision,
      policySnapshot,
      state: JOB_STATES.QUEUED
    });
  }

  getJob(jobId) {
    return this.store.getJob(jobId);
  }

  listJobs() {
    return this.store.listJobs();
  }

  async startJob(jobId, {
    threadStartParams = {},
    turnStartParams = {}
  } = {}) {
    const job = this.requireJob(jobId);
    if (TERMINAL_STATES.has(job.state)) {
      throw new RuntimeError("JOB_TERMINAL", `Cannot start terminal job ${jobId}`, { state: job.state });
    }

    try {
      this.store.transition(jobId, JOB_STATES.DISPATCHING, { reason: "dispatch-start" });

      const threadResponse = await this.adapter.threadStart(threadStartParams);
      const threadId = extractThreadId(threadResponse);
      if (threadId) {
        this.store.setProtocolRefs(jobId, { threadId });
      }

      this.store.transition(jobId, JOB_STATES.PLANNING, { reason: "thread-started" });

      const current = this.requireJob(jobId);
      const turnResponse = await this.adapter.turnStart({
        threadId: current.threadId,
        input: [{ type: "text", text: current.inputText }],
        ...turnStartParams
      });

      const turnId = extractTurnId(turnResponse);
      if (turnId) {
        this.store.setProtocolRefs(jobId, { turnId });
      }

      this.store.transition(jobId, JOB_STATES.RUNNING, { reason: "turn-started" });
      return this.requireJob(jobId);
    } catch (error) {
      this.failJob(jobId, error, "start-job-error");
      throw error;
    }
  }

  async interruptJob(jobId) {
    const job = this.requireJob(jobId);
    if (TERMINAL_STATES.has(job.state)) {
      return job;
    }

    if (!job.threadId || !job.turnId) {
      this.store.transition(jobId, JOB_STATES.CANCELLED, { reason: "interrupt-without-turn" });
      return this.requireJob(jobId);
    }

    try {
      await this.adapter.turnInterrupt({
        threadId: job.threadId,
        turnId: job.turnId
      });
    } catch (error) {
      this.failJob(jobId, error, "interrupt-error");
      throw error;
    }

    this.store.transition(jobId, JOB_STATES.CANCELLED, { reason: "interrupted" });
    return this.requireJob(jobId);
  }

  approveRequest(requestId, result = { approved: true }) {
    const mappedJobId = this.pendingApprovals.get(requestId) || null;
    this.adapter.sendRequestResponse(requestId, result);

    if (mappedJobId) {
      this.pendingApprovals.delete(requestId);
      const job = this.requireJob(mappedJobId);
      if (job.state === JOB_STATES.AWAITING_APPROVAL) {
        this.store.transition(mappedJobId, JOB_STATES.RUNNING, { reason: "approval-accepted" });
      }
    }
  }

  rejectRequest(requestId, message = "Request rejected") {
    const mappedJobId = this.pendingApprovals.get(requestId) || null;
    this.adapter.sendRequestError(requestId, message);

    if (mappedJobId) {
      this.pendingApprovals.delete(requestId);
      const job = this.requireJob(mappedJobId);
      if (!TERMINAL_STATES.has(job.state)) {
        this.store.transition(mappedJobId, JOB_STATES.CANCELLED, { reason: "approval-rejected" });
      }
    }
  }

  onApprovalRequest(message) {
    const requestId = message.id;
    const threadId = extractRequestThreadId(message);
    const job = threadId ? this.store.findByThreadId(threadId) : null;

    if (job && !TERMINAL_STATES.has(job.state)) {
      this.pendingApprovals.set(requestId, job.jobId);
      this.store.transition(job.jobId, JOB_STATES.AWAITING_APPROVAL, {
        reason: `approval-request:${message.method}`
      });
    }

    this.emit("approvalRequested", {
      requestId,
      method: message.method,
      params: message.params,
      jobId: job?.jobId || null
    });
  }

  onNotification(message) {
    const method = message.method;
    const params = message.params || {};

    if (method === "turn/started") {
      const turnId = extractTurnId(params);
      const threadId = extractThreadId(params);
      const job = turnId ? this.store.findByTurnId(turnId) : this.store.findByThreadId(threadId);
      if (job && !TERMINAL_STATES.has(job.state) && job.state !== JOB_STATES.RUNNING) {
        this.store.transition(job.jobId, JOB_STATES.RUNNING, { reason: "notification:turn-started" });
      }
    }

    if (method === "turn/completed") {
      const turnId = extractTurnId(params);
      const threadId = extractThreadId(params);
      const job = turnId ? this.store.findByTurnId(turnId) : this.store.findByThreadId(threadId);
      if (job && !TERMINAL_STATES.has(job.state)) {
        if (job.state !== JOB_STATES.SUMMARIZING) {
          this.store.transition(job.jobId, JOB_STATES.SUMMARIZING, {
            reason: "notification:turn-completed"
          });
        }
        this.store.transition(job.jobId, JOB_STATES.COMPLETED, {
          reason: "notification:turn-completed-final"
        });
      }
    }

    if (method === "thread/status/changed") {
      const threadId = extractThreadId(params);
      const job = this.store.findByThreadId(threadId);
      const status = params.status || params.state || null;
      if (job && !TERMINAL_STATES.has(job.state)) {
        if (status === "failed") {
          this.store.transition(job.jobId, JOB_STATES.FAILED, {
            reason: "notification:thread-failed"
          });
        }
        if (status === "cancelled") {
          this.store.transition(job.jobId, JOB_STATES.CANCELLED, {
            reason: "notification:thread-cancelled"
          });
        }
      }
    }

    this.emit("runtimeNotification", message);
  }

  failJob(jobId, error, reason) {
    const job = this.requireJob(jobId);
    if (!TERMINAL_STATES.has(job.state)) {
      this.store.transition(jobId, JOB_STATES.FAILED, {
        reason: `${reason}:${error.message}`
      });
    }
  }

  requireJob(jobId) {
    const job = this.store.getJob(jobId);
    assert(job, "JOB_NOT_FOUND", `job not found: ${jobId}`);
    return job;
  }
}
