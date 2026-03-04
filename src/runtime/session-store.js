import { EventEmitter } from "node:events";
import { assert } from "./errors.js";
import { assertTransition, JOB_STATES, isTerminalState } from "./state-machine.js";

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return structuredClone(value);
}

export class SessionStore extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
  }

  createJob({
    jobId,
    hostId,
    inputText,
    delegationMode,
    intent = null,
    plan = null,
    delegationDecision = null,
    policySnapshot,
    state = JOB_STATES.QUEUED,
    hostJobId = null,
    threadId = null,
    turnId = null
  }) {
    assert(jobId, "MISSING_JOB_ID", "jobId is required");
    assert(hostId, "MISSING_HOST_ID", "hostId is required");
    assert(inputText, "MISSING_INPUT_TEXT", "inputText is required");
    assert(delegationMode, "MISSING_DELEGATION_MODE", "delegationMode is required");
    assert(policySnapshot, "MISSING_POLICY_SNAPSHOT", "policySnapshot is required");
    assert(!this.jobs.has(jobId), "JOB_EXISTS", `jobId already exists: ${jobId}`);

    const createdAt = nowIso();
    const job = {
      jobId,
      hostId,
      hostJobId,
      inputText,
      threadId,
      turnId,
      state,
      delegationMode,
      intent,
      plan,
      delegationDecision,
      policySnapshot,
      stateHistory: [
        {
          from: null,
          to: state,
          at: createdAt,
          reason: "job-created"
        }
      ],
      timestamps: {
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        endedAt: null
      },
      resultSummary: null,
      artifactPaths: []
    };

    this.jobs.set(jobId, job);
    this.emit("created", clone(job));
    return clone(job);
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    return job ? clone(job) : null;
  }

  listJobs() {
    return [...this.jobs.values()].map(clone);
  }

  transition(jobId, nextState, { reason = null, at = nowIso() } = {}) {
    const job = this.jobs.get(jobId);
    assert(job, "JOB_NOT_FOUND", `job not found: ${jobId}`);

    if (job.state === nextState) {
      return clone(job);
    }

    assertTransition(job.state, nextState);

    const previousState = job.state;
    job.state = nextState;
    job.timestamps.updatedAt = at;

    if (!job.timestamps.startedAt && nextState === JOB_STATES.RUNNING) {
      job.timestamps.startedAt = at;
    }

    if (isTerminalState(nextState)) {
      job.timestamps.endedAt = at;
    }

    job.stateHistory.push({
      from: previousState,
      to: nextState,
      at,
      reason
    });

    this.emit("transition", {
      jobId,
      from: previousState,
      to: nextState,
      reason,
      at
    });

    return clone(job);
  }

  patchJob(jobId, patch = {}) {
    const job = this.jobs.get(jobId);
    assert(job, "JOB_NOT_FOUND", `job not found: ${jobId}`);

    Object.assign(job, patch);
    job.timestamps.updatedAt = nowIso();
    this.emit("updated", clone(job));
    return clone(job);
  }

  setProtocolRefs(jobId, { hostJobId, threadId, turnId }) {
    const patch = {};
    if (hostJobId !== undefined) {
      patch.hostJobId = hostJobId;
    }
    if (threadId !== undefined) {
      patch.threadId = threadId;
    }
    if (turnId !== undefined) {
      patch.turnId = turnId;
    }
    return this.patchJob(jobId, patch);
  }

  setResult(jobId, { resultSummary = null, artifactPaths = null } = {}) {
    const patch = {};
    if (resultSummary !== null) {
      patch.resultSummary = resultSummary;
    }
    if (Array.isArray(artifactPaths)) {
      patch.artifactPaths = artifactPaths;
    }
    return this.patchJob(jobId, patch);
  }

  findByThreadId(threadId) {
    if (!threadId) {
      return null;
    }
    for (const job of this.jobs.values()) {
      if (job.threadId === threadId) {
        return clone(job);
      }
    }
    return null;
  }

  findByTurnId(turnId) {
    if (!turnId) {
      return null;
    }
    for (const job of this.jobs.values()) {
      if (job.turnId === turnId) {
        return clone(job);
      }
    }
    return null;
  }
}
