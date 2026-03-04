import test from "node:test";
import assert from "node:assert/strict";

import { JOB_STATES, canTransition, assertTransition, isTerminalState } from "../src/runtime/state-machine.js";

test("allows expected transitions", () => {
  assert.equal(canTransition(JOB_STATES.QUEUED, JOB_STATES.DISPATCHING), true);
  assert.equal(canTransition(JOB_STATES.DISPATCHING, JOB_STATES.PLANNING), true);
  assert.equal(canTransition(JOB_STATES.RUNNING, JOB_STATES.SUMMARIZING), true);
  assert.equal(canTransition(JOB_STATES.SUMMARIZING, JOB_STATES.COMPLETED), true);
});

test("rejects invalid transitions", () => {
  assert.equal(canTransition(JOB_STATES.QUEUED, JOB_STATES.COMPLETED), false);
  assert.throws(() => assertTransition(JOB_STATES.QUEUED, JOB_STATES.COMPLETED));
});

test("marks terminal states", () => {
  assert.equal(isTerminalState(JOB_STATES.COMPLETED), true);
  assert.equal(isTerminalState(JOB_STATES.FAILED), true);
  assert.equal(isTerminalState(JOB_STATES.CANCELLED), true);
  assert.equal(isTerminalState(JOB_STATES.RUNNING), false);
});
