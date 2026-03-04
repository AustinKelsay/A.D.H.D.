import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicPlan, validateStructuredPlan } from "../src/intent/router.js";
import { normalizeIntent } from "../src/intent/normalizer.js";
import { RuntimeError } from "../src/runtime/errors.js";

test("buildDeterministicPlan is reproducible for same input", () => {
  const intent = normalizeIntent({
    inputText: "Fix bug in ./src/runtime/host-runtime.js",
    hostConstraints: { hostId: "h_local", sandbox: "workspace-write" }
  });

  const options = {
    promptVersion: "conductor.v1",
    requestedMode: "multi_agent",
    delegationPolicy: {
      allowMultiAgent: true,
      multiAgentKillSwitch: false,
      defaultMode: "fallback_workers"
    },
    hostCapabilities: {
      multi_agent: true
    }
  };

  const first = buildDeterministicPlan(intent, options);
  const second = buildDeterministicPlan(intent, options);

  assert.deepEqual(first, second);
  assert.equal(first.contractVersion, "plan.v1");
  assert.equal(first.delegation.selectedMode, "multi_agent");
  assert.deepEqual(first.hostConstraints, { hostId: "h_local", sandbox: "workspace-write" });
});

test("multi-agent kill switch enforces fallback_workers", () => {
  const intent = normalizeIntent({
    inputText: "Open PR and merge release"
  });

  const plan = buildDeterministicPlan(intent, {
    promptVersion: "conductor.v1",
    requestedMode: "multi_agent",
    delegationPolicy: {
      multiAgentKillSwitch: true
    },
    hostCapabilities: {
      multi_agent: true
    }
  });

  assert.equal(plan.delegation.selectedMode, "fallback_workers");
  assert.equal(plan.delegation.reasonCode, "kill-switch");
  assert.equal(plan.delegation.killSwitchApplied, true);
});

test("delegation policy boolean strings are parsed safely", () => {
  const intent = normalizeIntent({
    inputText: "Open pull request and merge release"
  });

  const plan = buildDeterministicPlan(intent, {
    promptVersion: "conductor.v1",
    requestedMode: "multi_agent",
    delegationPolicy: {
      allowMultiAgent: "false"
    },
    hostCapabilities: {
      multi_agent: true
    }
  });

  assert.equal(plan.delegation.selectedMode, "fallback_workers");
  assert.equal(plan.delegation.reasonCode, "policy-disabled");
});

test("validateStructuredPlan fails for invalid plan shape", () => {
  assert.throws(
    () => validateStructuredPlan({ contractVersion: "plan.v1" }),
    (error) => error instanceof RuntimeError && error.code === "INVALID_PLAN"
  );
});

test("validateStructuredPlan fails when hostConstraints are tampered", () => {
  const intent = normalizeIntent({
    inputText: "Fix bug in ./src/runtime/host-runtime.js",
    hostConstraints: { hostId: "h_local", sandbox: "workspace-write" }
  });

  const plan = buildDeterministicPlan(intent, {
    promptVersion: "conductor.v1",
    requestedMode: "fallback_workers",
    delegationPolicy: {},
    hostCapabilities: { multi_agent: false }
  });

  plan.hostConstraints = { hostId: "h_other", sandbox: "workspace-write" };

  assert.throws(
    () => validateStructuredPlan(plan, { intent }),
    (error) => error instanceof RuntimeError && error.code === "INVALID_PLAN"
  );
});

test("buildDeterministicPlan fails fast with INVALID_INPUT for malformed intent", () => {
  assert.throws(
    () =>
      buildDeterministicPlan(
        {
          contractVersion: "intent.v1",
          rawText: "x",
          normalizedText: "x",
          workType: "bugfix",
          target: ".",
          profileHint: "fallback_workers",
          constraints: null,
          paths: []
        },
        { promptVersion: "conductor.v1" }
      ),
    (error) => error instanceof RuntimeError && error.code === "INVALID_INPUT"
  );
});
