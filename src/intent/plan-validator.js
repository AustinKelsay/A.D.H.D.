import { RuntimeError } from "../runtime/errors.js";
import { isDeepStrictEqual } from "node:util";
import { DELEGATION_MODES } from "./delegation-policy.js";

const RISK_LEVELS = new Set(["low", "medium", "high"]);
const MODES = new Set(Object.values(DELEGATION_MODES));
const EXPECTED_INTENT_CONTRACT_VERSION = "intent.v1";

function fail(message, details = undefined) {
  throw new RuntimeError("INVALID_PLAN", message, details);
}

function assertObject(value, message, details = undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(message, details);
  }
}

function assertString(value, label, { minLength = 1 } = {}) {
  if (typeof value !== "string" || value.trim().length < minLength) {
    fail(`${label} must be a non-empty string`, { label });
  }
}

function assertMode(value, label) {
  if (!MODES.has(value)) {
    fail(`${label} must be one of: ${[...MODES].join(", ")}`, { label, value });
  }
}

function assertSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    fail("steps must be a non-empty array");
  }

  const ids = new Set();
  for (const step of steps) {
    assertObject(step, "each step must be an object");
    assertString(step.id, "step.id");
    if (ids.has(step.id)) {
      fail("step.id values must be unique", { stepId: step.id });
    }
    ids.add(step.id);

    assertString(step.title, "step.title");
    assertString(step.acceptanceCriteria, "step.acceptanceCriteria");

    if (!RISK_LEVELS.has(step.risk)) {
      fail("step.risk must be one of: low, medium, high", { stepId: step.id, risk: step.risk });
    }
  }
}

function assertDelegation(delegation) {
  assertObject(delegation, "delegation must be an object");
  assertMode(delegation.requestedMode, "delegation.requestedMode");
  assertMode(delegation.selectedMode, "delegation.selectedMode");
  assertString(delegation.reasonCode, "delegation.reasonCode");
  assertString(delegation.reason, "delegation.reason");

  if (typeof delegation.killSwitchApplied !== "boolean") {
    fail("delegation.killSwitchApplied must be a boolean");
  }
}

export function validatePlan(plan, { intent = null } = {}) {
  assertObject(plan, "plan must be an object");

  if (plan.contractVersion !== "plan.v1") {
    fail("contractVersion must be 'plan.v1'", { contractVersion: plan.contractVersion });
  }

  if (plan.intentContractVersion !== EXPECTED_INTENT_CONTRACT_VERSION) {
    fail(`intentContractVersion must be '${EXPECTED_INTENT_CONTRACT_VERSION}'`, {
      expected: EXPECTED_INTENT_CONTRACT_VERSION,
      received: plan.intentContractVersion
    });
  }
  assertString(plan.promptVersion, "promptVersion");
  assertString(plan.summary, "summary");
  assertString(plan.workType, "workType");
  assertString(plan.target, "target");

  if (!Array.isArray(plan.constraints)) {
    fail("constraints must be an array");
  }
  if (!Array.isArray(plan.paths)) {
    fail("paths must be an array");
  }
  if (!plan.paths.every((entry) => typeof entry === "string")) {
    fail("paths must be an array of strings");
  }

  assertSteps(plan.steps);
  assertDelegation(plan.delegation);

  if (plan.hostConstraints !== null && plan.hostConstraints !== undefined) {
    assertObject(plan.hostConstraints, "hostConstraints must be an object or null");
  }

  if (plan.metadata !== null && plan.metadata !== undefined) {
    assertObject(plan.metadata, "metadata must be an object or null");
  }

  if (intent) {
    if (plan.intentContractVersion !== intent.contractVersion) {
      fail("intentContractVersion does not match intent.contractVersion", {
        expected: intent.contractVersion,
        received: plan.intentContractVersion
      });
    }

    const expectedHostConstraints = intent.hostConstraints ?? null;
    const receivedHostConstraints = plan.hostConstraints ?? null;
    if (!isDeepStrictEqual(receivedHostConstraints, expectedHostConstraints)) {
      fail("hostConstraints must be preserved from intent");
    }
  }

  return plan;
}
