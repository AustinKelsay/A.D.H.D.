#!/usr/bin/env node
import { AppServerProcess, CodexAppServerAdapter, loadAvailableMethods } from "../src/runtime/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const shouldInitialize = process.argv.includes("--initialize");

  const processManager = new AppServerProcess();
  processManager.start();

  const started = await new Promise((resolve, reject) => {
    const onStarted = (event) => {
      cleanup();
      resolve(event);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      processManager.off("started", onStarted);
      processManager.off("error", onError);
    };
    processManager.on("started", onStarted);
    processManager.on("error", onError);
  });

  try {
    if (!shouldInitialize) {
      // Baseline smoke for constrained environments: ensure the process starts and remains alive briefly.
      await sleep(250);
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            mode: "start-stop",
            pid: started.pid,
            note: "Pass --initialize for full JSON-RPC handshake smoke."
          },
          null,
          2
        )}\n`
      );
      return;
    }

    const methods = loadAvailableMethods();
    let init = null;
    let usedMode = null;
    let lastError = null;

    for (const mode of ["framed", "line"]) {
      const rpcClient = processManager.createRpcClient({
        requestTimeoutMs: 10000,
        outgoingMode: mode
      });
      const adapter = new CodexAppServerAdapter({
        rpcClient,
        availableMethods: methods
      });

      try {
        init = await adapter.initialize({
          clientInfo: {
            name: "adhd-runtime-smoke",
            version: "0.1.0"
          },
          capabilities: {}
        });
        adapter.initialized();
        usedMode = mode;
        rpcClient.close();
        break;
      } catch (error) {
        lastError = error;
        rpcClient.close();
      }
    }

    if (!init) {
      throw lastError || new Error("Failed to initialize app-server in both framed and line modes.");
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: "initialize",
          outgoingMode: usedMode,
          pid: started.pid,
          initialize: init
        },
        null,
        2
      )}\n`
    );
  } finally {
    await processManager.stop();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
