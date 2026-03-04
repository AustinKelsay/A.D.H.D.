import { createHash } from "node:crypto";

import { resolveDelegationMode } from "./delegation-policy.js";
import { validatePlan } from "./plan-validator.js";

function stableFingerprint(intent) {
  const source = JSON.stringify({
    normalizedText: intent.normalizedText,
    workType: intent.workType,
    target: intent.target,
    paths: intent.paths,
    constraints: intent.constraints,
    hostConstraints: intent.hostConstraints
  });

  return createHash("sha1").update(source).digest("hex");
}

function hasAmbiguity(intent) {
  return /\b(this|that|something|stuff|things)\b/i.test(intent.rawText);
}

function buildSteps(intent) {
  const steps = [];

  if (hasAmbiguity(intent)) {
    steps.push({
      id: "s01_clarify",
      title: "Clarify ambiguous scope before edits",
      acceptanceCriteria: "A concrete scope statement exists before any file modifications.",
      risk: "low"
    });
  }

  const stepOffset = steps.length;

  steps.push(
    {
      id: stepOffset === 0 ? "s01_scope" : "s02_scope",
      title: "Confirm scope, constraints, and target paths",
      acceptanceCriteria: "Target files, constraints, and expected outcome are explicit and internally consistent.",
      risk: "low"
    },
    {
      id: stepOffset === 0 ? "s02_execute" : "s03_execute",
      title: `Implement ${intent.workType} changes in ${intent.target}`,
      acceptanceCriteria: "Code and docs changes match requested behavior without violating constraints.",
      risk: intent.workType === "bugfix" ? "high" : "medium"
    },
    {
      id: stepOffset === 0 ? "s03_verify" : "s04_verify",
      title: "Verify behavior and report outcomes",
      acceptanceCriteria: intent.constraints.includes("tests-optional")
        ? "At least one non-test validation signal is captured and summarized."
        : "Relevant tests or deterministic checks are executed and summarized.",
      risk: "medium"
    }
  );

  return steps;
}

function summarize(intent) {
  const text = intent.normalizedText;
  if (text.length <= 120) {
    return text;
  }
  return `${text.slice(0, 117)}...`;
}

export function buildDeterministicPlan(intent, {
  promptVersion,
  requestedMode = null,
  delegationPolicy = {},
  hostCapabilities = null
} = {}) {
  const delegation = resolveDelegationMode({
    requestedMode,
    profileHint: intent.profileHint,
    delegationPolicy,
    hostCapabilities
  });

  const plan = {
    contractVersion: "plan.v1",
    intentContractVersion: intent.contractVersion,
    promptVersion,
    summary: summarize(intent),
    workType: intent.workType,
    target: intent.target,
    paths: intent.paths,
    constraints: intent.constraints,
    hostConstraints: intent.hostConstraints || null,
    steps: buildSteps(intent),
    delegation,
    metadata: {
      planner: "intent-router.v1",
      fingerprint: stableFingerprint(intent)
    }
  };

  return validatePlan(plan, { intent });
}

export function validateStructuredPlan(plan, { intent = null } = {}) {
  return validatePlan(plan, { intent });
}
