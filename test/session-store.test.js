import test from "node:test";
import assert from "node:assert/strict";

import { SessionStore } from "../src/runtime/session-store.js";
import { JOB_STATES } from "../src/runtime/state-machine.js";

function createStoreJob(store, overrides = {}) {
  return store.createJob({
    jobId: "j_test001",
    hostId: "h_test001",
    inputText: "Implement feature X",
    delegationMode: "fallback_workers",
    policySnapshot: {
      approvalPolicy: "on-request",
      sandboxPolicy: "workspaceWrite",
      maxWorkers: 1,
      timeoutMs: 1000
    },
    ...overrides
  });
}

test("creates and transitions job", () => {
  const store = new SessionStore();
  createStoreJob(store);

  let job = store.transition("j_test001", JOB_STATES.DISPATCHING, { reason: "dispatch" });
  assert.equal(job.state, JOB_STATES.DISPATCHING);

  job = store.transition("j_test001", JOB_STATES.PLANNING, { reason: "planning" });
  assert.equal(job.state, JOB_STATES.PLANNING);

  job = store.transition("j_test001", JOB_STATES.RUNNING, { reason: "running" });
  assert.equal(job.state, JOB_STATES.RUNNING);
  assert.ok(job.timestamps.startedAt);

  job = store.transition("j_test001", JOB_STATES.COMPLETED, { reason: "done" });
  assert.equal(job.state, JOB_STATES.COMPLETED);
  assert.ok(job.timestamps.endedAt);
});

test("rejects invalid transition", () => {
  const store = new SessionStore();
  createStoreJob(store, { jobId: "j_test002" });

  assert.throws(() => {
    store.transition("j_test002", JOB_STATES.COMPLETED, { reason: "invalid" });
  });
});

test("finds jobs by thread and turn ids", () => {
  const store = new SessionStore();
  createStoreJob(store, { jobId: "j_test003" });
  store.setProtocolRefs("j_test003", {
    threadId: "thread_1",
    turnId: "turn_1"
  });

  assert.equal(store.findByThreadId("thread_1")?.jobId, "j_test003");
  assert.equal(store.findByTurnId("turn_1")?.jobId, "j_test003");
});

test("stores optional intent/plan metadata on create", () => {
  const store = new SessionStore();
  const intent = { contractVersion: "intent.v1", rawText: "Fix bug", tags: ["alpha"] };
  const plan = { contractVersion: "plan.v1", steps: [{ id: "s1" }] };
  const delegationDecision = { selectedMode: "fallback_workers" };
  const policySnapshot = {
    approvalPolicy: "on-request",
    sandboxPolicy: "workspaceWrite",
    maxWorkers: 1,
    timeoutMs: 1000
  };

  const created = createStoreJob(store, {
    jobId: "j_test004",
    intent,
    plan,
    delegationDecision,
    policySnapshot
  });

  intent.tags.push("mutated");
  plan.steps[0].id = "tampered";
  delegationDecision.selectedMode = "multi_agent";
  policySnapshot.maxWorkers = 99;

  const reread = store.getJob("j_test004");
  assert.equal(created.intent.contractVersion, "intent.v1");
  assert.equal(created.plan.contractVersion, "plan.v1");
  assert.equal(created.delegationDecision.selectedMode, "fallback_workers");
  assert.deepEqual(reread.intent.tags, ["alpha"]);
  assert.equal(reread.plan.steps[0].id, "s1");
  assert.equal(reread.delegationDecision.selectedMode, "fallback_workers");
  assert.equal(reread.policySnapshot.maxWorkers, 1);
});
