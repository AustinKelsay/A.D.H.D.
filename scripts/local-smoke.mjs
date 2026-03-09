#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import {
  bootstrapFederationHost,
  readPositiveIntEnv,
  requestJson,
  sleep,
  startNodeScript,
  waitForHealth
} from "./shared/local-stack-utils.mjs";

const repoRoot = process.cwd();
const hostPort = readPositiveIntEnv("ADHD_HOST_PORT", 8787);
const federationPort = readPositiveIntEnv("ADHD_FEDERATION_PORT", 8788);
const hostIds = (process.env.ADHD_FED_HOSTS || "h_alpha01")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const rpcRequestTimeoutMs = readPositiveIntEnv("ADHD_RPC_REQUEST_TIMEOUT_MS", 60000);
const startupTimeoutMs = readPositiveIntEnv(
  "ADHD_LOCAL_START_TIMEOUT_MS",
  Math.max(rpcRequestTimeoutMs + 15000, 30000)
);
const smokeTimeoutMs = readPositiveIntEnv("ADHD_LOCAL_SMOKE_TIMEOUT_MS", 45000);
const pollIntervalMs = 500;

async function postJson(url, body) {
  return requestJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function getJson(url) {
  return requestJson(url);
}

function assertOk(response, message) {
  if (!response.ok || !response.json?.ok) {
    throw new Error(
      `${message} failed with status ${response.status}${response.text ? `: ${response.text}` : ""}`
    );
  }
  return response.json;
}

async function waitForJobState(baseUrl, jobId, allowedStates) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < smokeTimeoutMs) {
    const response = await getJson(`${baseUrl}/api/jobs/${jobId}`);
    const json = assertOk(response, `job read for ${jobId}`);
    lastState = json.job?.state || null;
    if (allowedStates.has(lastState)) {
      return json;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timed out after ${smokeTimeoutMs}ms waiting for ${jobId} to reach one of ${[...allowedStates].join(", ")}; last state was ${lastState}`
  );
}

async function main() {
  const targetHostId = hostIds[0] || "h_alpha01";
  const services = [];
  const heartbeatLoops = [];

  const shutdown = async () => {
    for (const loop of heartbeatLoops) {
      loop.stop();
    }
    for (const service of services.reverse()) {
      await service.stop().catch(() => {});
    }
  };

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
          ADHD_FED_HOSTS: hostIds.join(","),
          ADHD_RPC_REQUEST_TIMEOUT_MS: String(rpcRequestTimeoutMs)
        }
      }
    );
    services.push(federation);

    const hostHealthUrl = `http://127.0.0.1:${hostPort}/health`;
    const federationBaseUrl = `http://127.0.0.1:${federationPort}`;

    const [hostHealth, federationHealth] = await Promise.all([
      waitForHealth(hostHealthUrl, {
        name: "host health",
        timeoutMs: startupTimeoutMs
      }),
      waitForHealth(`${federationBaseUrl}/health`, {
        name: "federation health",
        timeoutMs: startupTimeoutMs
      })
    ]);

    if (hostHealth.runtime?.ready !== true) {
      throw new Error(
        `Host runtime is not ready: ${hostHealth.runtime?.error?.code || "UNKNOWN"}${
          hostHealth.runtime?.error?.message ? ` (${hostHealth.runtime.error.message})` : ""
        }. Try ADHD_RPC_REQUEST_TIMEOUT_MS=120000 npm run local:smoke, or run ADHD_RUNTIME_SMOKE_TIMEOUT_MS=60000 node scripts/runtime-smoke.mjs --initialize for deeper diagnostics.`
      );
    }
    if (hostHealth.workflow?.preflight?.ok !== true) {
      throw new Error("Host workflow preflight is not healthy. Check /health and WORKFLOW.md before rerunning local:smoke.");
    }

    for (const hostId of hostIds) {
      const loop = await bootstrapFederationHost(federationBaseUrl, {
        hostId,
        displayName: `${hostId}-local`,
        workflowStatus: hostHealth.workflow?.status?.loaded ? "loaded" : "invalid",
        workflowContentHash: hostHealth.workflow?.status?.contentHash || null,
        heartbeatIntervalMs: 10000
      });
      heartbeatLoops.push(loop);
    }

    const jobId = `j_local_smoke_${Date.now()}`;
    const created = assertOk(
      await postJson(`${federationBaseUrl}/api/jobs`, {
        hostId: targetHostId,
        jobId,
        inputText: "Local smoke test: summarize the repository status and stop."
      }),
      "job create"
    );

    const started = assertOk(
      await postJson(`${federationBaseUrl}/api/jobs/${jobId}/start`, {}),
      "job start"
    );

    const live = assertOk(
      await getJson(`${federationBaseUrl}/api/jobs/${jobId}/live`),
      "job live"
    );

    const observed = await waitForJobState(
      federationBaseUrl,
      jobId,
      new Set(["running", "awaiting_approval", "completed", "failed", "cancelled"])
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          hostPort,
          federationPort,
          hostId: targetHostId,
          health: {
            hostReady: hostHealth.runtime.ready,
            workflowPreflightOk: hostHealth.workflow.preflight.ok,
            controlPlaneOk: federationHealth.ok
          },
          smoke: {
            jobId,
            createdState: created.job?.state || null,
            startedState: started.job?.state || null,
            observedState: observed.job?.state || null,
            pendingApprovals: Array.isArray(live.pendingApprovals) ? live.pendingApprovals.length : 0
          }
        },
        null,
        2
      )}\n`
    );
  } finally {
    await shutdown();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
