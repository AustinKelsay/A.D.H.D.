import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WorkflowStore } from "../src/workflow/index.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adhd-workflow-store-"));
}

function writeWorkflowFile(dir, contents) {
  fs.writeFileSync(path.join(dir, "WORKFLOW.md"), contents, "utf8");
}

test("WorkflowStore loads workflow config and prompt template", async () => {
  const tempDir = makeTempDir();
  try {
    writeWorkflowFile(tempDir, `---
delegation:
  default_mode: "multi_agent"
  allow_multi_agent: false
  multi_agent_kill_switch: true
codex:
  command: "codex app-server --profile local"
  approval_policy: "never"
  thread_sandbox: "read-only"
  turn_sandbox_policy:
    type: "readOnly"
---
# Prompt
Run plan exactly as written.
`);

    const store = new WorkflowStore({
      repoRoot: tempDir,
      cwd: tempDir
    });
    await store.refreshAsync();

    const current = store.current();
    assert.equal(current.ok, true);
    assert.equal(current.workflow.path, path.join(tempDir, "WORKFLOW.md"));
    assert.match(current.workflow.promptTemplate, /Run plan exactly as written\./);

    const preflight = store.preflight();
    assert.deepEqual(preflight.ok, true);

    const delegation = store.getDelegationPolicy();
    assert.equal(delegation.defaultMode, "multi_agent");
    assert.equal(delegation.allowMultiAgent, false);
    assert.equal(delegation.multiAgentKillSwitch, true);

    const codex = store.getCodexPolicy();
    assert.equal(codex.command, "codex app-server --profile local");
    assert.equal(codex.approvalPolicy, "never");
    assert.equal(codex.threadSandbox, "read-only");
    assert.deepEqual(codex.turnSandboxPolicy, { type: "readOnly" });

    const startDefaults = store.getStartDefaults();
    assert.deepEqual(startDefaults, {
      threadStartParams: {
        approvalPolicy: "never",
        sandbox: "read-only"
      },
      turnStartParams: {
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" }
      }
    });

    const status = store.status();
    assert.equal(status.loaded, true);
    assert.equal(status.usingLastKnownGood, false);
    assert.equal(status.lastError, null);
    assert.equal(status.telemetry.attempts >= 1, true);
    assert.equal(status.telemetry.successes >= 1, true);
    assert.equal(status.telemetry.failures, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WorkflowStore keeps last-known-good workflow on invalid reload", async () => {
  const tempDir = makeTempDir();
  try {
    writeWorkflowFile(tempDir, `---
codex:
  command: "codex app-server"
---
initial prompt
`);

    const store = new WorkflowStore({
      repoRoot: tempDir,
      cwd: tempDir
    });
    await store.refreshAsync();
    const initial = store.current();
    assert.equal(initial.ok, true);
    const initialHash = initial.workflow.contentHash;

    // writeWorkflowFile creates a codex block without codex.command, so WorkflowStore.refreshAsync()
    // (same validation path as refresh()) should fail with refresh.error.code === "WORKFLOW_INVALID".
    writeWorkflowFile(tempDir, `---
codex:
  approval_policy: "on-request"
---
broken prompt
`);

    const refresh = await store.refreshAsync();
    assert.equal(refresh.ok, false);
    assert.equal(refresh.error.code, "WORKFLOW_INVALID");

    const current = store.current();
    assert.equal(current.ok, true);
    assert.equal(current.stale, true);
    assert.equal(current.workflow.contentHash, initialHash);

    const status = store.status();
    assert.equal(status.loaded, true);
    assert.equal(status.usingLastKnownGood, true);
    assert.equal(status.lastError.code, "WORKFLOW_INVALID");
    assert.equal(status.telemetry.failures >= 1, true);
    assert.equal(status.telemetry.lastFailure.code, "WORKFLOW_INVALID");

    const preflight = store.preflight();
    assert.equal(preflight.ok, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WorkflowStore preflight fails when workflow file is missing", async () => {
  const tempDir = makeTempDir();
  try {
    const store = new WorkflowStore({
      repoRoot: tempDir,
      cwd: tempDir
    });
    await store.refreshAsync();

    const preflight = store.preflight();
    assert.equal(preflight.ok, false);
    assert.equal(preflight.error.code, "WORKFLOW_MISSING");

    const status = store.status();
    assert.equal(status.loaded, false);
    assert.equal(status.lastError.code, "WORKFLOW_MISSING");
    assert.equal(status.telemetry.failures >= 1, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WorkflowStore rejects workspace roots that escape repo containment", async () => {
  const tempDir = makeTempDir();
  try {
    const escapeRoot = path.dirname(tempDir);
    writeWorkflowFile(tempDir, `---
workspace:
  root: ${JSON.stringify(escapeRoot)}
  require_path_containment: true
codex:
  command: "codex app-server"
---
prompt
`);

    const store = new WorkflowStore({
      repoRoot: tempDir,
      cwd: tempDir
    });
    const refresh = await store.refreshAsync();

    assert.equal(refresh.ok, false);
    assert.equal(refresh.error.code, "WORKFLOW_PARSE_ERROR");

    const preflight = store.preflight();
    assert.equal(preflight.ok, false);
    assert.equal(preflight.error.code, "WORKFLOW_PARSE_ERROR");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WorkflowStore rejects hooks.timeout_ms with non-integer suffixes", async () => {
  const tempDir = makeTempDir();
  try {
    writeWorkflowFile(tempDir, `---
hooks:
  timeout_ms: "50ms"
codex:
  command: "codex app-server"
---
prompt
`);

    const store = new WorkflowStore({
      repoRoot: tempDir,
      cwd: tempDir
    });
    const refresh = await store.refreshAsync();

    assert.equal(refresh.ok, false);
    assert.equal(refresh.error.code, "WORKFLOW_INVALID");
    assert.equal(refresh.error.details.field, "hooks.timeout_ms");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
