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

  assertIncludes(host.required, "hostId", "host.required");
  assertIncludes(host.required, "capabilities", "host.required");
  assertIncludes(host.required, "compatibility", "host.required");

  assertIncludes(job.required, "jobId", "job.required");
  assertIncludes(job.required, "hostId", "job.required");
  assertIncludes(job.required, "state", "job.required");
  assertIncludes(job.required, "delegationMode", "job.required");

  const jobStates = job?.properties?.state?.enum || [];
  assertIncludes(jobStates, "dispatching", "job.properties.state.enum");
  assertIncludes(jobStates, "planning", "job.properties.state.enum");

  const payload = {
    ok: true,
    checkedAt: new Date().toISOString(),
    files: ["config/schemas/host.schema.json", "config/schemas/job.schema.json"]
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main();
