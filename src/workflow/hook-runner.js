import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { RuntimeError } from "../runtime/errors.js";

const DEFAULT_OUTPUT_LIMIT = 4000;
const DEFAULT_KILL_GRACE_MS = 250;
const MAX_CAPTURE_BYTES = 64 * 1024;

function sanitizeText(raw, maxChars = DEFAULT_OUTPUT_LIMIT) {
  if (typeof raw !== "string" || !raw.length) {
    return "";
  }

  const redacted = raw
    .replace(/\b(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b(token|secret|password|api[_-]?key)(\s*[:=]\s*)([^\s]+)/gi, "$1$2[REDACTED]");

  if (redacted.length <= maxChars) {
    return redacted;
  }
  return `${redacted.slice(0, maxChars)}...[truncated]`;
}

function isPathContained(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (!relativePath) {
    return true;
  }
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function toHookField(hookName) {
  return hookName.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`);
}

export function resolveJobWorkspacePath(jobId, workspacePolicy) {
  const rootPath = workspacePolicy?.rootPath;
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    throw new RuntimeError("WORKFLOW_INVALID", "workspace rootPath is not configured");
  }

  const workspacePath = path.resolve(rootPath, jobId);
  if (workspacePolicy.requirePathContainment !== false && !isPathContained(rootPath, workspacePath)) {
    throw new RuntimeError("WORKFLOW_INVALID", `Workspace path escapes configured root for job ${jobId}`, {
      jobId,
      workspacePath,
      rootPath
    });
  }

  return workspacePath;
}

async function ensureWorkspace(jobId, workspacePolicy) {
  const workspacePath = resolveJobWorkspacePath(jobId, workspacePolicy);
  const existed = fs.existsSync(workspacePath);
  await fs.promises.mkdir(workspacePath, { recursive: true });
  return {
    workspacePath,
    created: !existed
  };
}

function buildHookEnv({ job, hostId, workspacePath, hookName }) {
  return {
    ...process.env,
    ADHD_HOOK_NAME: hookName,
    ADHD_HOST_ID: hostId,
    ADHD_JOB_ID: job.jobId,
    ADHD_WORKSPACE_PATH: workspacePath,
    ADHD_HOOK_CONTEXT: JSON.stringify({
      job,
      host: {
        hostId
      },
      hook: hookName
    })
  };
}

async function runCommand(command, {
  cwd,
  env,
  timeoutMs
}) {
  await fs.promises.mkdir(cwd, { recursive: true });

  return await new Promise((resolve, reject) => {
    const child = spawn(process.env.SHELL || "/bin/sh", ["-lc", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;

    const pushOutput = (target, chunk) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      const combined = Buffer.concat([target, incoming], target.length + incoming.length);
      if (combined.length <= MAX_CAPTURE_BYTES) {
        return combined;
      }
      return combined.subarray(combined.length - MAX_CAPTURE_BYTES);
    };

    child.stdout.on("data", (chunk) => {
      stdout = pushOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = pushOutput(stderr, chunk);
    });
    child.on("error", reject);

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, DEFAULT_KILL_GRACE_MS);
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        timedOut,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8")
      });
    });
  });
}

export function createWorkflowHookRunner({
  hostId,
  getHookPolicy,
  getWorkspacePolicy,
  logEvent = null
} = {}) {
  const emit = (event, payload = {}) => {
    if (typeof logEvent !== "function") {
      return;
    }
    logEvent({
      event,
      ...payload
    });
  };

  const runHook = async (hookName, job, {
    required = false,
    ensureWorkspaceExists = false
  } = {}) => {
    const hookPolicy = typeof getHookPolicy === "function" ? getHookPolicy() : null;
    const workspacePolicy = typeof getWorkspacePolicy === "function" ? getWorkspacePolicy() : null;
    const command = hookPolicy?.[hookName] || null;
    if (!command) {
      return {
        ok: true,
        skipped: true,
        hookName,
        workspacePath: workspacePolicy ? resolveJobWorkspacePath(job.jobId, workspacePolicy) : null
      };
    }

    const workspace = ensureWorkspaceExists
      ? await ensureWorkspace(job.jobId, workspacePolicy)
      : {
          workspacePath: resolveJobWorkspacePath(job.jobId, workspacePolicy),
          created: false
        };

    const result = await runCommand(command, {
      cwd: workspace.workspacePath,
      env: buildHookEnv({
        job,
        hostId,
        workspacePath: workspace.workspacePath,
        hookName: toHookField(hookName)
      }),
      timeoutMs: hookPolicy.timeoutMs
    });

    const payload = {
      hookName,
      jobId: job.jobId,
      workspacePath: workspace.workspacePath,
      timedOut: result.timedOut,
      exitCode: result.code,
      signal: result.signal,
      stdout: sanitizeText(result.stdout),
      stderr: sanitizeText(result.stderr)
    };

    if (result.timedOut || result.code !== 0) {
      emit("workflow.hook.failed", payload);
      if (required) {
        throw new RuntimeError("WORKFLOW_HOOK_FAILED", `Workflow hook failed: ${hookName}`, payload);
      }
      return {
        ok: false,
        ...payload
      };
    }

    emit("workflow.hook.succeeded", payload);
    return {
      ok: true,
      ...payload
    };
  };

  return {
    ensureWorkspace,
    resolveJobWorkspacePath(jobId) {
      return resolveJobWorkspacePath(jobId, getWorkspacePolicy());
    },
    async onJobCreated(job) {
      const workspace = await ensureWorkspace(job.jobId, getWorkspacePolicy());
      if (workspace.created) {
        await runHook("afterCreate", job, {
          required: true,
          ensureWorkspaceExists: false
        });
      }
      return workspace;
    },
    async beforeRun(job) {
      const workspace = await ensureWorkspace(job.jobId, getWorkspacePolicy());
      if (workspace.created) {
        await runHook("afterCreate", job, {
          required: true,
          ensureWorkspaceExists: false
        });
      }
      await runHook("beforeRun", job, {
        required: true,
        ensureWorkspaceExists: false
      });
      return workspace;
    },
    async afterRun(job) {
      try {
        await runHook("afterRun", job, {
          required: false,
          ensureWorkspaceExists: false
        });
      } catch {
        // best effort hook should not raise
      }
    },
    async beforeRemove(job) {
      let workspacePath = null;
      try {
        workspacePath = resolveJobWorkspacePath(job.jobId, getWorkspacePolicy());
        if (fs.existsSync(workspacePath)) {
          await runHook("beforeRemove", job, {
            required: false,
            ensureWorkspaceExists: false
          });
          await fs.promises.rm(workspacePath, { recursive: true, force: true });
        }
      } catch (error) {
        emit("workflow.hook.cleanup_failed", {
          hookName: "beforeRemove",
          jobId: job.jobId,
          workspacePath,
          message: error?.message || "unknown error"
        });
      }
    }
  };
}
