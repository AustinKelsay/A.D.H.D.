import { TransitionError } from "./errors.js";

export const JOB_STATES = Object.freeze({
  DRAFT: "draft",
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  PLANNING: "planning",
  AWAITING_APPROVAL: "awaiting_approval",
  DELEGATING: "delegating",
  RUNNING: "running",
  SUMMARIZING: "summarizing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

const TERMINAL_STATES = new Set([
  JOB_STATES.COMPLETED,
  JOB_STATES.FAILED,
  JOB_STATES.CANCELLED
]);

export const ALLOWED_TRANSITIONS = Object.freeze({
  [JOB_STATES.DRAFT]: new Set([JOB_STATES.QUEUED, JOB_STATES.CANCELLED]),
  [JOB_STATES.QUEUED]: new Set([JOB_STATES.DISPATCHING, JOB_STATES.FAILED, JOB_STATES.CANCELLED]),
  [JOB_STATES.DISPATCHING]: new Set([JOB_STATES.PLANNING, JOB_STATES.FAILED, JOB_STATES.CANCELLED]),
  [JOB_STATES.PLANNING]: new Set([
    JOB_STATES.AWAITING_APPROVAL,
    JOB_STATES.DELEGATING,
    JOB_STATES.RUNNING,
    JOB_STATES.FAILED,
    JOB_STATES.CANCELLED
  ]),
  [JOB_STATES.AWAITING_APPROVAL]: new Set([
    JOB_STATES.DELEGATING,
    JOB_STATES.RUNNING,
    JOB_STATES.FAILED,
    JOB_STATES.CANCELLED
  ]),
  [JOB_STATES.DELEGATING]: new Set([
    JOB_STATES.AWAITING_APPROVAL,
    JOB_STATES.RUNNING,
    JOB_STATES.FAILED,
    JOB_STATES.CANCELLED
  ]),
  [JOB_STATES.RUNNING]: new Set([
    JOB_STATES.AWAITING_APPROVAL,
    JOB_STATES.SUMMARIZING,
    JOB_STATES.COMPLETED,
    JOB_STATES.FAILED,
    JOB_STATES.CANCELLED
  ]),
  [JOB_STATES.SUMMARIZING]: new Set([JOB_STATES.COMPLETED, JOB_STATES.FAILED, JOB_STATES.CANCELLED]),
  [JOB_STATES.COMPLETED]: new Set([JOB_STATES.QUEUED]),
  [JOB_STATES.FAILED]: new Set([JOB_STATES.QUEUED]),
  [JOB_STATES.CANCELLED]: new Set([JOB_STATES.QUEUED])
});

export function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

export function canTransition(from, to) {
  if (from === to) {
    return true;
  }

  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }

  return allowed.has(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new TransitionError(from, to);
  }
}
