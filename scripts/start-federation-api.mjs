#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

import {
  AppServerProcess,
  CodexAppServerAdapter,
  HostRuntime,
  loadAvailableMethods
} from "../src/runtime/index.js";
import { createFederationApiHandler, HOST_ID_PATTERN } from "../src/server/federation-api.js";

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

function envString(name, defaultValue = null) {
  const value = process.env[name];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : defaultValue;
}

function envPositiveInt(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  const rawValue = String(value).trim();
  if (!/^[0-9]+$/.test(rawValue)) {
    return defaultValue;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function parseHostIds() {
  const source = process.env.ADHD_FED_HOSTS || "h_alpha01,h_bravo02";
  const rawIds = source
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (rawIds.length === 0) {
    throw new Error("ADHD_FED_HOSTS must contain at least one host id.");
  }

  const invalid = rawIds.filter((hostId) => !HOST_ID_PATTERN.test(hostId));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid ADHD_FED_HOSTS entries: ${invalid.join(", ")} (expected ^h_[a-z0-9]{6,}$)`
    );
  }

  const seen = new Set();
  const ids = [];
  for (const hostId of rawIds) {
    if (seen.has(hostId)) {
      continue;
    }
    seen.add(hostId);
    ids.push(hostId);
  }

  if (ids.length === 0) {
    throw new Error("ADHD_FED_HOSTS has no valid unique host ids.");
  }
  return ids;
}

function parsePort() {
  const rawPort = process.env.PORT ?? "8787";
  const normalized = String(rawPort).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }

  const port = Number.parseInt(normalized, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }
  return port;
}

async function initializeHostRuntime({
  hostId,
  skipInitialize,
  rpcOutgoingMode,
  defaultHostCapabilities,
  defaultDelegationPolicy,
  mobileRuntimeConfig
}) {
  const processManager = new AppServerProcess({
    codexBin: process.env.ADHD_CODEX_BIN || "codex",
    cwd: process.env.ADHD_HOST_CWD || process.cwd()
  });
  processManager.on("stderr", (line) => {
    if (!line?.trim()) {
      return;
    }
    process.stderr.write(`[${hostId}] ${line}`);
  });
  processManager.start();

  const rpcClient = processManager.createRpcClient({
    requestTimeoutMs: 15000,
    outgoingMode: rpcOutgoingMode
  });

  const adapter = new CodexAppServerAdapter({
    rpcClient,
    availableMethods: loadAvailableMethods()
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
    process.stdout.write(`${JSON.stringify({ type: "approvalRequested", hostId, ...event })}\n`);
  });

  return {
    processManager,
    rpcClient,
    runtime,
    hostConfig: {
      runtime,
      isRuntimeReady: () => runtimeStatus.ready,
      getRuntimeStatus: () => ({ ...runtimeStatus }),
      getHostCapabilities: () => ({ ...defaultHostCapabilities }),
      getDelegationPolicy: () => ({ ...defaultDelegationPolicy }),
      getMobileConfig: () => ({ ...mobileRuntimeConfig })
    },
    runtimeStatus
  };
}

async function main() {
  const port = parsePort();
  const skipInitialize = envBoolean("ADHD_SKIP_INITIALIZE", false);
  const rpcOutgoingMode = process.env.ADHD_RPC_OUTGOING_MODE || "framed";
  const hostIds = parseHostIds();

  const defaultHostCapabilities = {
    multi_agent: envBoolean("ADHD_HOST_MULTI_AGENT", false)
  };
  const defaultDelegationPolicy = {
    defaultMode: envMode("ADHD_DELEGATION_DEFAULT_MODE", "fallback_workers"),
    allowMultiAgent: envBoolean("ADHD_DELEGATION_ALLOW_MULTI_AGENT", true),
    multiAgentKillSwitch: envBoolean("ADHD_MULTI_AGENT_KILL_SWITCH", false)
  };
  const mobileRuntimeConfig = {
    enabled: envBoolean("ADHD_MOBILE_ENABLED", true),
    pairingTtlMs: envPositiveInt("ADHD_MOBILE_PAIRING_TTL_MS", 5 * 60 * 1000),
    sessionTtlMs: envPositiveInt("ADHD_MOBILE_SESSION_TTL_MS", 30 * 24 * 60 * 60 * 1000),
    eventsMax: envPositiveInt("ADHD_MOBILE_EVENTS_MAX", 1000),
    streamHeartbeatMs: envPositiveInt("ADHD_MOBILE_HEARTBEAT_MS", 15000),
    maxPendingPairings: envPositiveInt("ADHD_MOBILE_MAX_PENDING_PAIRINGS", 100)
  };

  const hostResources = [];
  const hosts = {};
  for (const hostId of hostIds) {
    const hostResource = await initializeHostRuntime({
      hostId,
      skipInitialize,
      rpcOutgoingMode,
      defaultHostCapabilities,
      defaultDelegationPolicy,
      mobileRuntimeConfig
    });
    hostResources.push(hostResource);
    hosts[hostId] = hostResource.hostConfig;
  }

  const handler = createFederationApiHandler({
    hosts,
    catalogStorePath: envString(
      "ADHD_FED_CATALOG_PATH",
      path.join(process.cwd(), ".adhd", "federation-run-catalog.json")
    ),
    heartbeatDegradedMs: envPositiveInt("ADHD_HEARTBEAT_DEGRADED_MS", 15000),
    heartbeatOfflineMs: envPositiveInt("ADHD_HEARTBEAT_OFFLINE_MS", 30000)
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
        controlPlane: true,
        port,
        hostIds,
        runtime: {
          skipInitialize,
          rpcOutgoingMode
        },
        hostCapabilities: defaultHostCapabilities,
        delegationPolicy: defaultDelegationPolicy,
        mobile: mobileRuntimeConfig
      },
      null,
      2
    )}\n`
  );

  const shutdown = async (signal) => {
    process.stdout.write(`Shutting down federation API (${signal})...\n`);
    await new Promise((resolve) => server.close(resolve));
    for (const resource of hostResources) {
      resource.rpcClient.close();
      await resource.processManager.stop();
    }
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
