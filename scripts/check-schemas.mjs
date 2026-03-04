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

function main() {
  const host = readJson("config/schemas/host.schema.json");
  const job = readJson("config/schemas/job.schema.json");
  const intent = readJson("config/schemas/intent.schema.json");
  const plan = readJson("config/schemas/plan.schema.json");

  assertIncludes(host.required, "hostId", "host.required");
  assertIncludes(host.required, "capabilities", "host.required");
  assertIncludes(host.required, "compatibility", "host.required");

  assertIncludes(job.required, "jobId", "job.required");
  assertIncludes(job.required, "hostId", "job.required");
  assertIncludes(job.required, "state", "job.required");
  assertIncludes(job.required, "delegationMode", "job.required");
  assertIncludes(job.properties ? Object.keys(job.properties) : [], "intent", "job.properties");
  assertIncludes(job.properties ? Object.keys(job.properties) : [], "plan", "job.properties");
  assertIncludes(job.properties ? Object.keys(job.properties) : [], "delegationDecision", "job.properties");
  if (!Array.isArray(job?.properties?.intent?.anyOf)) {
    throw new Error("job.properties.intent.anyOf must be present");
  }
  if (!Array.isArray(job?.properties?.plan?.anyOf)) {
    throw new Error("job.properties.plan.anyOf must be present");
  }

  assertIncludes(intent.required, "contractVersion", "intent.required");
  assertIncludes(intent.required, "rawText", "intent.required");
  assertIncludes(intent.required, "normalizedText", "intent.required");
  assertIncludes(intent.required, "profileHint", "intent.required");
  const profileHints = intent?.properties?.profileHint?.enum || [];
  assertIncludes(profileHints, "multi_agent", "intent.properties.profileHint.enum");
  assertIncludes(profileHints, "fallback_workers", "intent.properties.profileHint.enum");

  assertIncludes(plan.required, "contractVersion", "plan.required");
  assertIncludes(plan.required, "steps", "plan.required");
  assertIncludes(plan.required, "delegation", "plan.required");
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
