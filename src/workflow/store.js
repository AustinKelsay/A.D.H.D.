import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const WORKFLOW_FILENAME = "WORKFLOW.md";

const DEFAULT_DELEGATION_POLICY = Object.freeze({
  defaultMode: "fallback_workers",
  allowMultiAgent: true,
  multiAgentKillSwitch: false
});

const DEFAULT_CODEX_POLICY = Object.freeze({
  command: "codex app-server",
  approvalPolicy: "on-request",
  threadSandbox: "workspace-write",
  turnSandboxPolicy: { type: "workspaceWrite" },
  turnTimeoutMs: 3600000,
  readTimeoutMs: 15000,
  stallTimeoutMs: 300000
});

function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function toSha1(text) {
  return createHash("sha1").update(text).digest("hex");
}

function asBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
}

function asMode(value, fallback = "fallback_workers") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "multi_agent" || normalized === "fallback_workers") {
    return normalized;
  }
  return fallback;
}

function asPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return "";
  }

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "null") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  return trimmed;
}

function parseYamlFrontMatter(rawText) {
  const root = {};
  const stack = [{ indent: -1, target: root }];
  const lines = rawText.split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      continue;
    }
    if (/^\s*#/.test(rawLine)) {
      continue;
    }

    const indentMatch = rawLine.match(/^ */);
    const indent = indentMatch ? indentMatch[0].length : 0;
    if (indent % 2 !== 0) {
      throw new Error(`Invalid indentation in workflow front matter: ${rawLine}`);
    }

    const trimmed = rawLine.trim();
    const match = trimmed.match(/^([A-Za-z0-9_.-]+):(.*)$/);
    if (!match) {
      throw new Error(`Invalid workflow front matter line: ${rawLine}`);
    }

    const key = match[1];
    const valueText = match[2].trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].target;

    if (valueText === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, target: child });
      continue;
    }

    parent[key] = parseScalar(valueText);
  }

  return root;
}

function parseWorkflowText(content) {
  if (typeof content !== "string") {
    throw new Error("Workflow content must be a string");
  }

  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[0].trim() === "---") {
    let closingIndex = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === "---") {
        closingIndex = index;
        break;
      }
    }

    if (closingIndex < 0) {
      throw new Error("Workflow front matter is not closed with ---");
    }

    const rawFrontMatter = lines.slice(1, closingIndex).join("\n");
    const promptTemplate = lines.slice(closingIndex + 1).join("\n").trim();
    const config = parseYamlFrontMatter(rawFrontMatter);

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("Workflow front matter must parse to an object");
    }

    return {
      config,
      promptTemplate
    };
  }

  return {
    config: {},
    promptTemplate: content.trim()
  };
}

function validateWorkflowConfig(config = {}) {
  const codex = config.codex && typeof config.codex === "object" && !Array.isArray(config.codex)
    ? config.codex
    : {};
  const hasCodexConfig = Object.keys(codex).length > 0;
  if (!hasCodexConfig) {
    return { ok: true };
  }

  const command = codex.command;
  if (typeof command !== "string" || !command.trim()) {
    return {
      ok: false,
      code: "WORKFLOW_INVALID",
      message: "workflow codex.command is required and must be a non-empty string",
      details: {
        field: "codex.command"
      }
    };
  }

  return { ok: true };
}

function resolveCandidatePath({
  workflowPath = null,
  repoRoot = process.cwd(),
  cwd = process.cwd()
} = {}) {
  if (typeof workflowPath === "string" && workflowPath.trim()) {
    return path.resolve(workflowPath.trim());
  }

  const repoPath = path.resolve(repoRoot, WORKFLOW_FILENAME);
  if (fs.existsSync(repoPath)) {
    return repoPath;
  }

  return path.resolve(cwd, WORKFLOW_FILENAME);
}

function buildLoadError(error, workflowPath) {
  const code = error?.code === "ENOENT"
    ? "WORKFLOW_MISSING"
    : "WORKFLOW_LOAD_ERROR";

  return {
    code,
    message: error?.code === "ENOENT"
      ? `Workflow file not found: ${workflowPath}`
      : `Unable to load workflow: ${error?.message || "unknown error"}`,
    details: {
      path: workflowPath,
      cause: error?.message || "unknown"
    }
  };
}

export class WorkflowStore {
  constructor({
    workflowPath = null,
    repoRoot = process.cwd(),
    cwd = process.cwd()
  } = {}) {
    this.explicitWorkflowPath = workflowPath;
    this.repoRoot = repoRoot;
    this.cwd = cwd;

    this.active = null;
    this.lastError = null;
    this.lastHash = null;
    this.refreshInFlight = null;
    this.nextAutoRefreshAtMs = 0;
    this.autoRefreshIntervalMs = 500;
    this.reloadTelemetry = {
      attempts: 0,
      successes: 0,
      failures: 0,
      unchanged: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailure: null
    };
    this.lastPath = resolveCandidatePath({
      workflowPath: this.explicitWorkflowPath,
      repoRoot: this.repoRoot,
      cwd: this.cwd
    });
  }

  getWorkflowPath() {
    return resolveCandidatePath({
      workflowPath: this.explicitWorkflowPath,
      repoRoot: this.repoRoot,
      cwd: this.cwd
    });
  }

  async refreshAsync() {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      this.reloadTelemetry.attempts += 1;
      this.reloadTelemetry.lastAttemptAt = nowIso();
      const workflowPath = this.getWorkflowPath();
      this.lastPath = workflowPath;

      let content;
      try {
        content = await fs.promises.readFile(workflowPath, "utf8");
      } catch (error) {
        this.lastError = buildLoadError(error, workflowPath);
        this.reloadTelemetry.failures += 1;
        this.reloadTelemetry.lastFailureAt = nowIso();
        this.reloadTelemetry.lastFailure = clone(this.lastError);
        return {
          ok: false,
          error: clone(this.lastError),
          active: this.active ? clone(this.active) : null
        };
      }

      const contentHash = toSha1(content);
      if (this.active && this.lastHash === contentHash) {
        this.lastError = null;
        this.reloadTelemetry.successes += 1;
        this.reloadTelemetry.unchanged += 1;
        this.reloadTelemetry.lastSuccessAt = nowIso();
        return {
          ok: true,
          changed: false,
          workflow: clone(this.active)
        };
      }

      try {
        const parsed = parseWorkflowText(content);
        const validation = validateWorkflowConfig(parsed.config);
        if (!validation.ok) {
          this.lastError = {
            ...validation,
            details: {
              ...validation.details,
              path: workflowPath
            }
          };
          this.reloadTelemetry.failures += 1;
          this.reloadTelemetry.lastFailureAt = nowIso();
          this.reloadTelemetry.lastFailure = clone(this.lastError);
          return {
            ok: false,
            error: clone(this.lastError),
            active: this.active ? clone(this.active) : null
          };
        }

        this.active = {
          path: workflowPath,
          loadedAt: nowIso(),
          contentHash,
          config: parsed.config,
          promptTemplate: parsed.promptTemplate
        };
        this.lastHash = contentHash;
        this.lastError = null;
        this.reloadTelemetry.successes += 1;
        this.reloadTelemetry.lastSuccessAt = nowIso();

        return {
          ok: true,
          changed: true,
          workflow: clone(this.active)
        };
      } catch (error) {
        this.lastError = {
          code: "WORKFLOW_PARSE_ERROR",
          message: `Invalid workflow format: ${error?.message || "parse failure"}`,
          details: {
            path: workflowPath
          }
        };
        this.reloadTelemetry.failures += 1;
        this.reloadTelemetry.lastFailureAt = nowIso();
        this.reloadTelemetry.lastFailure = clone(this.lastError);
        return {
          ok: false,
          error: clone(this.lastError),
          active: this.active ? clone(this.active) : null
        };
      }
    })()
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  refresh() {
    return this.refreshAsync();
  }

  triggerBackgroundRefresh() {
    const nowMs = Date.now();
    if (this.refreshInFlight || nowMs < this.nextAutoRefreshAtMs) {
      return;
    }
    this.nextAutoRefreshAtMs = nowMs + this.autoRefreshIntervalMs;
    void this.refreshAsync();
  }

  current() {
    this.triggerBackgroundRefresh();
    if (this.active) {
      return {
        ok: true,
        workflow: clone(this.active),
        stale: Boolean(this.lastError)
      };
    }

    return {
      ok: false,
      error: clone(this.lastError || {
        code: "WORKFLOW_UNAVAILABLE",
        message: "No workflow is loaded",
        details: {
          path: this.lastPath
        }
      })
    };
  }

  preflight() {
    const current = this.current();
    if (!current.ok) {
      return {
        ok: false,
        error: current.error
      };
    }

    const validation = validateWorkflowConfig(current.workflow.config);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          ...validation,
          details: {
            ...validation.details,
            path: current.workflow.path
          }
        }
      };
    }

    return {
      ok: true,
      workflow: current.workflow
    };
  }

  status() {
    this.triggerBackgroundRefresh();
    return {
      path: this.lastPath,
      loaded: Boolean(this.active),
      loadedAt: this.active?.loadedAt || null,
      contentHash: this.active?.contentHash || null,
      usingLastKnownGood: Boolean(this.active && this.lastError),
      refreshing: Boolean(this.refreshInFlight),
      lastError: this.lastError ? clone(this.lastError) : null,
      telemetry: clone(this.reloadTelemetry)
    };
  }

  getDelegationPolicy() {
    const current = this.current();
    if (!current.ok) {
      return clone(DEFAULT_DELEGATION_POLICY);
    }

    const delegation = current.workflow.config?.delegation;
    if (!delegation || typeof delegation !== "object" || Array.isArray(delegation)) {
      return clone(DEFAULT_DELEGATION_POLICY);
    }

    return {
      defaultMode: asMode(
        delegation.default_mode ?? delegation.defaultMode,
        DEFAULT_DELEGATION_POLICY.defaultMode
      ),
      allowMultiAgent: asBoolean(
        delegation.allow_multi_agent ?? delegation.allowMultiAgent,
        DEFAULT_DELEGATION_POLICY.allowMultiAgent
      ),
      multiAgentKillSwitch: asBoolean(
        delegation.multi_agent_kill_switch ?? delegation.multiAgentKillSwitch,
        DEFAULT_DELEGATION_POLICY.multiAgentKillSwitch
      )
    };
  }

  getCodexPolicy() {
    const current = this.current();
    if (!current.ok) {
      return clone(DEFAULT_CODEX_POLICY);
    }

    const codex = current.workflow.config?.codex;
    if (!codex || typeof codex !== "object" || Array.isArray(codex)) {
      return clone(DEFAULT_CODEX_POLICY);
    }

    return {
      command: typeof codex.command === "string" && codex.command.trim()
        ? codex.command.trim()
        : DEFAULT_CODEX_POLICY.command,
      approvalPolicy: typeof codex.approval_policy === "string" && codex.approval_policy.trim()
        ? codex.approval_policy.trim()
        : DEFAULT_CODEX_POLICY.approvalPolicy,
      threadSandbox: typeof codex.thread_sandbox === "string" && codex.thread_sandbox.trim()
        ? codex.thread_sandbox.trim()
        : DEFAULT_CODEX_POLICY.threadSandbox,
      turnSandboxPolicy:
        codex.turn_sandbox_policy && typeof codex.turn_sandbox_policy === "object" && !Array.isArray(codex.turn_sandbox_policy)
          ? clone(codex.turn_sandbox_policy)
          : clone(DEFAULT_CODEX_POLICY.turnSandboxPolicy),
      turnTimeoutMs: asPositiveInt(codex.turn_timeout_ms, DEFAULT_CODEX_POLICY.turnTimeoutMs),
      readTimeoutMs: asPositiveInt(codex.read_timeout_ms, DEFAULT_CODEX_POLICY.readTimeoutMs),
      stallTimeoutMs: asPositiveInt(codex.stall_timeout_ms, DEFAULT_CODEX_POLICY.stallTimeoutMs)
    };
  }

  getStartDefaults() {
    const codex = this.getCodexPolicy();
    return {
      threadStartParams: {
        approvalPolicy: codex.approvalPolicy,
        sandbox: codex.threadSandbox
      },
      turnStartParams: {
        approvalPolicy: codex.approvalPolicy,
        sandboxPolicy: codex.turnSandboxPolicy
      }
    };
  }
}

export function resolveWorkflowPath(options = {}) {
  return resolveCandidatePath(options);
}
