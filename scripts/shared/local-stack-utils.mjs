import { spawn } from "node:child_process";
import process from "node:process";

function prefixStream(stream, prefix, sink) {
  if (!stream) {
    return;
  }

  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      sink.write(`${prefix}${line}\n`);
    }
  });
  stream.on("end", () => {
    if (pending) {
      sink.write(`${prefix}${pending}\n`);
      pending = "";
    }
  });
}

export function readPositiveIntEnv(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return fallback;
  }

  const normalized = String(rawValue).trim();
  if (!/^\d+$/.test(normalized)) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestJson(url, {
  method = "GET",
  headers = {},
  body,
  timeoutMs = 5000
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      text,
      json
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForHealth(url, {
  name,
  timeoutMs = 30000,
  intervalMs = 250,
  validate = (response) => response.status === 200 && response.json?.ok === true
} = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await requestJson(url, { timeoutMs: Math.min(timeoutMs, 5000) });
      if (validate(response)) {
        return response.json;
      }
      lastError = new Error(
        `${name || url} returned status ${response.status}${response.text ? `: ${response.text}` : ""}`
      );
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${name || url}${
      lastError ? ` (${lastError.message})` : ""
    }`
  );
}

export async function bootstrapFederationHost(baseUrl, {
  hostId,
  displayName = null,
  workflowStatus = "loaded",
  workflowContentHash = null,
  heartbeatIntervalMs = 10000
} = {}) {
  const register = await requestJson(`${baseUrl}/api/hosts/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      hostId,
      displayName: displayName || hostId
    })
  });
  if (!register.ok || !register.json?.ok || typeof register.json?.enrollmentToken !== "string") {
    throw new Error(
      `Host register failed for ${hostId} with status ${register.status}${
        register.text ? `: ${register.text}` : ""
      }`
    );
  }

  const workflow = {
    status: workflowStatus,
    contentHash: workflowContentHash
  };
  const enroll = await requestJson(`${baseUrl}/api/hosts/${hostId}/enroll`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      enrollmentToken: register.json.enrollmentToken,
      capabilities: {
        codexVersion: "local-dev",
        appServer: true,
        mcp: true,
        mcpServer: true,
        features: {
          multi_agent: {
            stage: "experimental",
            enabled: false
          }
        }
      },
      compatibility: {
        status: "compatible",
        checkedAt: new Date().toISOString(),
        missingMethods: []
      },
      workflow
    })
  });
  if (!enroll.ok || !enroll.json?.ok || typeof enroll.json?.hostToken !== "string") {
    throw new Error(
      `Host enroll failed for ${hostId} with status ${enroll.status}${
        enroll.text ? `: ${enroll.text}` : ""
      }`
    );
  }

  const sendHeartbeat = async () => {
    const heartbeat = await requestJson(`${baseUrl}/api/hosts/${hostId}/heartbeat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${enroll.json.hostToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workflow
      })
    });
    if (!heartbeat.ok || !heartbeat.json?.ok) {
      throw new Error(
        `Host heartbeat failed for ${hostId} with status ${heartbeat.status}${
          heartbeat.text ? `: ${heartbeat.text}` : ""
        }`
      );
    }
    return heartbeat.json;
  };

  await sendHeartbeat();

  let timer = null;
  if (Number.isSafeInteger(heartbeatIntervalMs) && heartbeatIntervalMs > 0) {
    timer = setInterval(() => {
      sendHeartbeat().catch((error) => {
        process.stderr.write(`[bootstrap] heartbeat failed for ${hostId}: ${error.message}\n`);
      });
    }, heartbeatIntervalMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  return {
    hostToken: enroll.json.hostToken,
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

export function startNodeScript(name, scriptPath, {
  cwd = process.cwd(),
  env = {},
  stdoutPrefix = `[${name}] `,
  stderrPrefix = `[${name}] `
} = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  prefixStream(child.stdout, stdoutPrefix, process.stdout);
  prefixStream(child.stderr, stderrPrefix, process.stderr);

  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

  return {
    name,
    child,
    exitPromise,
    async stop(signal = "SIGTERM") {
      if (child.exitCode !== null || child.killed) {
        return;
      }

      child.kill(signal);
      const result = await Promise.race([
        exitPromise,
        sleep(5000).then(() => null)
      ]);
      if (result) {
        return;
      }

      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await exitPromise;
      }
    }
  };
}
