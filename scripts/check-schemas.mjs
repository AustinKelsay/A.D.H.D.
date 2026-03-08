#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readJson(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing file: ${relPath}`);
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function assertIncludes(haystack, needle, label) {
  if (!Array.isArray(haystack) || !haystack.includes(needle)) {
    throw new Error(`${label} must include '${needle}'`);
  }
}

function assertRequiredSuperset(actual, expected, label) {
  if (!Array.isArray(actual)) {
    throw new Error(`${label} must be an array`);
  }
  for (const entry of expected) {
    if (!actual.includes(entry)) {
      throw new Error(`${label} must include '${entry}'`);
    }
  }
}

function assertNullableAnyOf(anyOf, label) {
  if (!Array.isArray(anyOf)) {
    throw new Error(`${label} must be present`);
  }
  const hasNullBranch = anyOf.some((entry) => entry?.type === "null" || entry?.const === null);
  if (!hasNullBranch) {
    throw new Error(`${label} must include a nullable branch`);
  }
}

function main() {
  const host = readJson("config/schemas/host.schema.json");
  const job = readJson("config/schemas/job.schema.json");
  const intent = readJson("config/schemas/intent.schema.json");
  const plan = readJson("config/schemas/plan.schema.json");
  const expectedRequiredIntent = [
    "contractVersion",
    "rawText",
    "normalizedText",
    "workType",
    "profileHint",
    "target",
    "paths",
    "constraints",
    "hostConstraints",
    "metadata"
  ];
  const expectedRequiredPlan = [
    "contractVersion",
    "intentContractVersion",
    "promptVersion",
    "summary",
    "workType",
    "target",
    "paths",
    "constraints",
    "hostConstraints",
    "steps",
    "delegation",
    "metadata"
  ];

  assertIncludes(host.required, "hostId", "host.required");
  assertIncludes(host.required, "capabilities", "host.required");
  assertIncludes(host.required, "compatibility", "host.required");

  assertIncludes(job.required, "jobId", "job.required");
  assertIncludes(job.required, "hostId", "job.required");
  assertIncludes(job.required, "state", "job.required");
  assertIncludes(job.required, "delegationMode", "job.required");
  const jobPropKeys = job.properties ? Object.keys(job.properties) : [];
  assertIncludes(jobPropKeys, "intake", "job.properties");
  assertIncludes(jobPropKeys, "intent", "job.properties");
  assertIncludes(jobPropKeys, "plan", "job.properties");
  assertIncludes(jobPropKeys, "delegationDecision", "job.properties");
  assertNullableAnyOf(job?.properties?.intent?.anyOf, "job.properties.intent.anyOf");
  assertNullableAnyOf(job?.properties?.plan?.anyOf, "job.properties.plan.anyOf");

  assertRequiredSuperset(intent.required, expectedRequiredIntent, "intent.required");
  const profileHints = intent?.properties?.profileHint?.enum || [];
  assertIncludes(profileHints, "multi_agent", "intent.properties.profileHint.enum");
  assertIncludes(profileHints, "fallback_workers", "intent.properties.profileHint.enum");

  assertRequiredSuperset(plan.required, expectedRequiredPlan, "plan.required");
  const planModes = plan?.properties?.delegation?.properties?.selectedMode?.enum || [];
  assertIncludes(planModes, "multi_agent", "plan.properties.delegation.properties.selectedMode.enum");
  assertIncludes(planModes, "fallback_workers", "plan.properties.delegation.properties.selectedMode.enum");

  const jobStates = job?.properties?.state?.enum || [];
  assertIncludes(jobStates, "dispatching", "job.properties.state.enum");
  assertIncludes(jobStates, "planning", "job.properties.state.enum");

  const payload = {
    ok: true,
    checkedAt: new Date().toISOString(),
    files: [
      "config/schemas/host.schema.json",
      "config/schemas/job.schema.json",
      "config/schemas/intent.schema.json",
      "config/schemas/plan.schema.json"
    ]
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main();
