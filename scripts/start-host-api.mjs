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

function envBoolean(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envMode(name, defaultValue = "fallback_workers") {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return ["multi_agent", "fallback_workers"].includes(normalized) ? normalized : defaultValue;
}

async function main() {
  const hostId = process.env.ADHD_HOST_ID || "h_local";
  const port = Number.parseInt(process.env.PORT || "8787", 10);
  const skipInitialize = envBoolean("ADHD_SKIP_INITIALIZE", false);
  const rpcOutgoingMode = process.env.ADHD_RPC_OUTGOING_MODE || "framed";
  const hostCapabilities = {
    multi_agent: envBoolean("ADHD_HOST_MULTI_AGENT", false)
  };
  const defaultDelegationPolicy = {
    defaultMode: envMode("ADHD_DELEGATION_DEFAULT_MODE", "fallback_workers"),
    allowMultiAgent: envBoolean("ADHD_DELEGATION_ALLOW_MULTI_AGENT", true),
    multiAgentKillSwitch: envBoolean("ADHD_MULTI_AGENT_KILL_SWITCH", false)
  };

  const processManager = new AppServerProcess({
    codexBin: process.env.ADHD_CODEX_BIN || "codex",
    cwd: process.env.ADHD_HOST_CWD || process.cwd()
  });

  processManager.on("stderr", (line) => {
    if (!line?.trim()) {
      return;
    }
    process.stderr.write(`[codex] ${line}`);
  });

  processManager.start();

  const rpcClient = processManager.createRpcClient({
    requestTimeoutMs: 15000,
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
    process.stdout.write(`${JSON.stringify({ type: "approvalRequested", ...event })}\n`);
  });

  const handler = createHostApiHandler({
    runtime,
    hostId,
    isRuntimeReady: () => runtimeStatus.ready,
    getRuntimeStatus: () => ({ ...runtimeStatus }),
    getHostCapabilities: () => ({ ...hostCapabilities }),
    getDelegationPolicy: () => ({ ...defaultDelegationPolicy })
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
        delegationPolicy: defaultDelegationPolicy,
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
