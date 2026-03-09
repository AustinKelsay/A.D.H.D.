#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import {
  bootstrapFederationHost,
  readPositiveIntEnv,
  startNodeScript,
  waitForHealth
} from "./shared/local-stack-utils.mjs";

const repoRoot = process.cwd();
const hostPort = readPositiveIntEnv("ADHD_HOST_PORT", 8787);
const federationPort = readPositiveIntEnv("ADHD_FEDERATION_PORT", 8788);
const hostIds = process.env.ADHD_FED_HOSTS || "h_alpha01";
const rpcRequestTimeoutMs = readPositiveIntEnv("ADHD_RPC_REQUEST_TIMEOUT_MS", 60000);
const startupTimeoutMs = readPositiveIntEnv(
  "ADHD_LOCAL_START_TIMEOUT_MS",
  Math.max(rpcRequestTimeoutMs + 15000, 30000)
);

async function main() {
  const services = [];
  const heartbeatLoops = [];
  let shuttingDown = false;

  const shutdown = async (reason) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (reason) {
      process.stderr.write(`${reason}\n`);
    }
    for (const service of services.reverse()) {
      await service.stop().catch(() => {});
    }
    for (const loop of heartbeatLoops) {
      loop.stop();
    }
  };

  const onSignal = (signal) => {
    shutdown(`Stopping local stack (${signal})...`)
      .then(() => process.exit(0))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exit(1);
      });
  };

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  try {
    const host = startNodeScript("host", path.join(repoRoot, "scripts/start-host-api.mjs"), {
      cwd: repoRoot,
      env: {
        PORT: String(hostPort),
        ADHD_RPC_REQUEST_TIMEOUT_MS: String(rpcRequestTimeoutMs)
      }
    });
    services.push(host);

    const federation = startNodeScript(
      "federation",
      path.join(repoRoot, "scripts/start-federation-api.mjs"),
      {
        cwd: repoRoot,
        env: {
          PORT: String(federationPort),
          ADHD_FED_HOSTS: hostIds,
          ADHD_RPC_REQUEST_TIMEOUT_MS: String(rpcRequestTimeoutMs)
        }
      }
    );
    services.push(federation);

    const crashWatch = services.map((service) =>
      service.exitPromise.then(({ code, signal }) => {
        throw new Error(
          `${service.name} exited before local stack was ready (code=${code ?? "null"}, signal=${signal ?? "null"})`
        );
      })
    );

    const hostHealthUrl = `http://127.0.0.1:${hostPort}/health`;
    const federationHealthUrl = `http://127.0.0.1:${federationPort}/health`;
    const [hostHealth, federationHealth] = await Promise.race([
      Promise.all([
        waitForHealth(hostHealthUrl, {
          name: "host health",
          timeoutMs: startupTimeoutMs
        }),
        waitForHealth(federationHealthUrl, {
          name: "federation health",
          timeoutMs: startupTimeoutMs
        })
      ]),
      Promise.race(crashWatch)
    ]);

    for (const hostId of hostIds.split(",").map((value) => value.trim()).filter(Boolean)) {
      const loop = await bootstrapFederationHost(`http://127.0.0.1:${federationPort}`, {
        hostId,
        displayName: `${hostId}-local`,
        workflowStatus: hostHealth.workflow?.status?.loaded ? "loaded" : "invalid",
        workflowContentHash: hostHealth.workflow?.status?.contentHash || null
      });
      heartbeatLoops.push(loop);
    }

    const hostReady = hostHealth.runtime?.ready === true;
    const workflowPreflightOk = hostHealth.workflow?.preflight?.ok === true;

    process.stdout.write(
      [
        "",
        "Local stack is ready.",
        `- Host health: ${hostHealthUrl}`,
        `- Federation health: ${federationHealthUrl}`,
        `- Federated hosts: ${hostIds}`,
        `- Host runtime ready: ${hostReady}`,
        `- Host workflow preflight: ${workflowPreflightOk}`,
        `- Federation online hosts: ${federationHealth.hosts?.online ?? 0}`,
        "",
        "Next steps:",
        `- Run a smoke test: npm run local:smoke`,
        `- Host metrics: curl -sS http://127.0.0.1:${hostPort}/metrics`,
        `- Federation metrics: curl -sS http://127.0.0.1:${federationPort}/metrics`,
        "",
        "Press Ctrl-C to stop both services.",
        ""
      ].join("\n")
    );

    if (!hostReady) {
      process.stdout.write(
        [
          "Warning:",
          `- Host runtime is not ready: ${hostHealth.runtime?.error?.code || "UNKNOWN"}${hostHealth.runtime?.error?.message ? ` (${hostHealth.runtime.error.message})` : ""}`,
          "- Health and metrics are available, but job execution will not work until Codex initialization succeeds.",
          "- Retry with a longer RPC timeout if startup is slow: ADHD_RPC_REQUEST_TIMEOUT_MS=120000 npm run local:up",
          "- For deeper runtime verification, run: ADHD_RUNTIME_SMOKE_TIMEOUT_MS=60000 node scripts/runtime-smoke.mjs --initialize",
          ""
        ].join("\n")
      );
    }

    await Promise.race(crashWatch);
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
