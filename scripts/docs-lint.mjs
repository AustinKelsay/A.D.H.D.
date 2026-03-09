#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REQUIRED = [
  "README.md",
  "llm/project/project-overview.md",
  "llm/project/phase-11-planning-checkpoint.md",
  "llm/project/user-flow.md",
  "llm/project/tech-stack.md",
  "llm/project/project-rules.md",
  "llm/project/backlog.md",
  "llm/project/contracts/control-plane-host-node.md",
  "llm/project/contracts/workflow-contract.md",
  "llm/project/phases/setup-phase.md",
  "llm/project/phases/session-runtime-phase.md",
  "llm/project/phases/intent-router-phase.md",
  "llm/project/phases/mvp-phase.md",
  "llm/project/phases/mobile-control-phase.md",
  "llm/project/phases/multi-host-federation-phase.md",
  "llm/project/phases/run-catalog-phase.md",
  "llm/project/phases/reliability-and-observability-phase.md",
  "llm/project/phases/review-and-hardening-phase.md",
  "llm/project/phases/release-and-distribution-phase.md",
  "llm/project/phases/operations-and-sustainment-phase.md",
  "llm/project/phases/tauri-app-shell-phase.md",
  "llm/project/phases/desktop-client-phase.md",
  "llm/project/phases/mobile-client-phase.md",
  "llm/project/phases/dictation-intake-phase.md",
  "llm/project/phases/asr-runtime-integration-phase.md",
  "llm/project/phases/app-packaging-and-onboarding-phase.md",
  "llm/workflows/phase-0-bootstrap.md",
  "llm/workflows/phase-3-mvp-operator.md",
  "llm/workflows/phase-4-mobile-operator.md",
  "llm/workflows/phase-5-federation-operator.md",
  "llm/workflows/phase-6-run-catalog-operator.md",
  "llm/workflows/phase-7-reliability-operator.md",
  "llm/workflows/phase-8-hardening-operator.md",
  "llm/workflows/phase-9-host-bootstrap.md",
  "llm/workflows/phase-9-workflow-rollout.md",
  "llm/workflows/phase-10-operations-operator.md",
  "llm/workflows/phase-11-tauri-shell-bootstrap.md",
  "llm/workflows/phase-12-desktop-client-operator.md"
];

const cwd = process.cwd();
const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(cwd, rel)));

const payload = {
  ok: missing.length === 0,
  checkedAt: new Date().toISOString(),
  requiredCount: REQUIRED.length,
  missing
};

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
process.exit(missing.length === 0 ? 0 : 1);
