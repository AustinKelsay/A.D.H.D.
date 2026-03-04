import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { HostRuntime } from "../src/runtime/host-runtime.js";
import { JOB_STATES } from "../src/runtime/state-machine.js";

class FakeAdapter extends EventEmitter {
  async initialize() {
    return { userAgent: "fake" };
  }

  initialized() {}

  async threadStart() {
    return { thread: { id: "thread_1" } };
  }

  async turnStart() {
    return { turn: { id: "turn_1" } };
  }

  async turnInterrupt() {
    return { ok: true };
  }

  sendRequestResponse() {}

  sendRequestError() {}
}

test("starts a queued job and sets thread/turn ids", async () => {
  const adapter = new FakeAdapter();
  const runtime = new HostRuntime({ adapter, hostId: "h_test001" });

  runtime.createJob({
    jobId: "j_test001",
    inputText: "Do the thing"
  });

  const job = await runtime.startJob("j_test001");
  assert.equal(job.state, JOB_STATES.RUNNING);
  assert.equal(job.threadId, "thread_1");
  assert.equal(job.turnId, "turn_1");
});

test("transitions to completed on turn/completed notification", async () => {
  const adapter = new FakeAdapter();
  const runtime = new HostRuntime({ adapter, hostId: "h_test002" });

  runtime.createJob({
    jobId: "j_test002",
    inputText: "Do the thing"
  });
  await runtime.startJob("j_test002");

  adapter.emit("notification", {
    method: "turn/completed",
    params: {
      turn: { id: "turn_1" }
    }
  });

  const job = runtime.getJob("j_test002");
  assert.equal(job.state, JOB_STATES.COMPLETED);
});

test("moves to awaiting_approval when approval request is emitted", async () => {
  const adapter = new FakeAdapter();
  const runtime = new HostRuntime({ adapter, hostId: "h_test003" });

  runtime.createJob({
    jobId: "j_test003",
    inputText: "Do the thing"
  });
  await runtime.startJob("j_test003");

  adapter.emit("approvalRequest", {
    id: 77,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread_1"
    }
  });

  const job = runtime.getJob("j_test003");
  assert.equal(job.state, JOB_STATES.AWAITING_APPROVAL);

  runtime.approveRequest(77, { approved: true });
  const resumed = runtime.getJob("j_test003");
  assert.equal(resumed.state, JOB_STATES.RUNNING);
});
