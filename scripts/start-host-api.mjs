#!/usr/bin/env node
import http from "node:http";
import process from "node:process";

import {
  AppServerProcess,
  CodexAppServerAdapter,
  HostRuntime,
  JsonRpcClient,
  loadAvailableMethods
} from "../src/runtime/index.js";
import { createHostApiHandler } from "../src/server/host-api.js";
import { WorkflowStore } from "../src/workflow/index.js";
import {
  emitStructuredEvent,
  resolveCodexCommand,
  resolveDelegationPolicy
} from "./shared/workflow-startup-utils.mjs";

function formatRawEnvValue(value) {
  if (value === undefined) {
    return "<undefined>";
  }
  if (value === null) {
    return "<null>";
  }
  return JSON.stringify(String(value));
}

function warnEnvDefault(name, rawValue, defaultValue, reason) {
  console.warn(
    `[config] ${name}=${formatRawEnvValue(rawValue)} (${reason}); using default ${JSON.stringify(defaultValue)}`
  );
}

function envBoolean(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envMode(name, defaultValue = "fallback_workers") {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    warnEnvDefault(name, rawValue, defaultValue, "missing value");
    return defaultValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (["multi_agent", "fallback_workers"].includes(normalized)) {
    return normalized;
  }
  warnEnvDefault(name, rawValue, defaultValue, "invalid mode");
  return defaultValue;
}

function envPositiveInt(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    warnEnvDefault(name, rawValue, defaultValue, "missing value");
    return defaultValue;
  }
  const normalized = String(rawValue).trim();
  if (!/^[0-9]+$/.test(normalized)) {
    warnEnvDefault(name, rawValue, defaultValue, "not a positive integer");
    return defaultValue;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    warnEnvDefault(name, rawValue, defaultValue, "out of range");
    return defaultValue;
  }
  return parsed;
}

async function main() {
  const hostId = process.env.ADHD_HOST_ID || "h_local";
  const port = Number.parseInt(process.env.PORT || "8787", 10);
  const hostCwd = process.env.ADHD_HOST_CWD || process.cwd();
  const workflowStore = new WorkflowStore({
    workflowPath: process.env.ADHD_WORKFLOW_PATH || null,
    repoRoot: process.cwd(),
    cwd: hostCwd
  });
  const workflowBoot = await workflowStore.refreshAsync();
  if (!workflowBoot.ok && workflowBoot.error) {
    process.stderr.write(
      `[workflow] ${workflowBoot.error.code}: ${workflowBoot.error.message}\n`
    );
  }

  const skipInitialize = envBoolean("ADHD_SKIP_INITIALIZE", false);
  const rpcOutgoingMode = process.env.ADHD_RPC_OUTGOING_MODE || "framed";
  const hostCapabilities = {
    multi_agent: envBoolean("ADHD_HOST_MULTI_AGENT", false)
  };
  const envDelegationPolicy = {
    defaultMode: envMode("ADHD_DELEGATION_DEFAULT_MODE", "fallback_workers"),
    allowMultiAgent: envBoolean("ADHD_DELEGATION_ALLOW_MULTI_AGENT", true),
    multiAgentKillSwitch: envBoolean("ADHD_MULTI_AGENT_KILL_SWITCH", false)
  };
  const codexPolicy = workflowStore.getCodexPolicy();
  const codexCommand = resolveCodexCommand(
    codexPolicy.command,
    process.env.ADHD_CODEX_BIN || "codex"
  );
  const mobileRuntimeConfig = {
    enabled: envBoolean("ADHD_MOBILE_ENABLED", true),
    pairingTtlMs: envPositiveInt("ADHD_MOBILE_PAIRING_TTL_MS", 5 * 60 * 1000),
    sessionTtlMs: envPositiveInt("ADHD_MOBILE_SESSION_TTL_MS", 30 * 24 * 60 * 60 * 1000),
    eventsMax: envPositiveInt("ADHD_MOBILE_EVENTS_MAX", 1000),
    streamHeartbeatMs: envPositiveInt("ADHD_MOBILE_HEARTBEAT_MS", 15000),
    maxPendingPairings: envPositiveInt("ADHD_MOBILE_MAX_PENDING_PAIRINGS", 100)
  };

  const processManager = new AppServerProcess({
    codexBin: codexCommand.codexBin,
    extraArgs: codexCommand.extraArgs,
    cwd: hostCwd
  });

  processManager.on("stderr", (line) => {
    if (!line?.trim()) {
      return;
    }
    process.stderr.write(`[codex] ${line}`);
  });

  processManager.start();

  const rpcClient = processManager.createRpcClient({
    requestTimeoutMs: codexPolicy.readTimeoutMs,
    outgoingMode: rpcOutgoingMode
  });

  const availableMethods = loadAvailableMethods();
  const adapter = new CodexAppServerAdapter({
    rpcClient,
    availableMethods
  });
  const runtime = new HostRuntime({
    adapter,
    hostId
  });

  const runtimeStatus = {
    ready: false,
    error: null,
    initializedAt: null,
    skipInitialize
  };

  if (skipInitialize) {
    runtimeStatus.ready = true;
  } else {
    try {
      await runtime.initialize();
      runtimeStatus.ready = true;
      runtimeStatus.initializedAt = new Date().toISOString();
    } catch (error) {
      runtimeStatus.ready = false;
      runtimeStatus.error = {
        code: error.code || "INITIALIZE_FAILED",
        message: error.message
      };
    }
  }

  runtime.on("approvalRequested", (event) => {
    emitStructuredEvent("approvalRequested", event);
  });

  const handler = createHostApiHandler({
    runtime,
    hostId,
    isRuntimeReady: () => runtimeStatus.ready,
    getRuntimeStatus: () => ({ ...runtimeStatus }),
    getHostCapabilities: () => ({ ...hostCapabilities }),
    getDelegationPolicy: () => resolveDelegationPolicy(workflowStore, envDelegationPolicy),
    getMobileConfig: () => ({ ...mobileRuntimeConfig }),
    getWorkflowStatus: () => workflowStore.status(),
    validateWorkflowPreflight: () => workflowStore.preflight(),
    getWorkflowStartDefaults: () => workflowStore.getStartDefaults(),
    refreshWorkflow: () => workflowStore.refreshAsync(),
    logEvent: (event) => emitStructuredEvent("hostApiTelemetry", event)
  });

  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        `${JSON.stringify(
          {
            ok: false,
            error: {
              code: error.code || "INTERNAL_ERROR",
              message: error.message
            }
          },
          null,
          2
        )}\n`
      );
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        hostId,
        port,
        runtime: runtimeStatus,
        hostCapabilities,
        delegationPolicy: resolveDelegationPolicy(workflowStore, envDelegationPolicy),
        workflow: workflowStore.status(),
        codexPolicy,
        mobile: mobileRuntimeConfig,
        rpcOutgoingMode
      },
      null,
      2
    )}\n`
  );

  const shutdown = async (signal) => {
    process.stdout.write(`Shutting down (${signal})...\n`);
    await new Promise((resolve) => server.close(resolve));
    rpcClient.close();
    await processManager.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
  });

  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
