import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { RuntimeError } from "../errors.js";
import { JsonRpcClient } from "./jsonrpc.js";

export class AppServerProcess extends EventEmitter {
  constructor({
    codexBin = "codex",
    cwd = process.cwd(),
    env = process.env,
    listen = "stdio://",
    extraArgs = []
  } = {}) {
    super();

    this.codexBin = codexBin;
    this.cwd = cwd;
    this.env = env;
    this.listen = listen;
    this.extraArgs = extraArgs;

    this.child = null;
  }

  start() {
    if (this.child) {
      throw new RuntimeError("APP_SERVER_ALREADY_RUNNING", "App server process already running");
    }

    if (this.listen !== "stdio://") {
      throw new RuntimeError(
        "UNSUPPORTED_TRANSPORT",
        `Unsupported listen transport for phase-1 process manager: ${this.listen}`,
        {
          supported: ["stdio://"]
        }
      );
    }

    const args = ["app-server", "--listen", this.listen, ...this.extraArgs];
    const child = spawn(this.codexBin, args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child = child;

    child.on("spawn", () => {
      this.emit("started", { pid: child.pid, command: this.codexBin, args });
    });

    child.stdout.on("data", (chunk) => this.emit("stdout", chunk));
    child.stderr.on("data", (chunk) => this.emit("stderr", chunk.toString("utf8")));

    child.on("error", (error) => {
      this.emit("error", error);
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      this.emit("exited", { code, signal });
    });

    return child;
  }

  createRpcClient(options = {}) {
    if (!this.child) {
      throw new RuntimeError("APP_SERVER_NOT_RUNNING", "App server process is not running");
    }

    return new JsonRpcClient({
      input: this.child.stdout,
      output: this.child.stdin,
      ...options
    });
  }

  async stop({ signal = "SIGTERM", timeoutMs = 5000 } = {}) {
    if (!this.child) {
      return { alreadyStopped: true };
    }

    const child = this.child;

    const waitForExit = new Promise((resolve) => {
      child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });

    child.kill(signal);

    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve({ timeout: true }), timeoutMs);
    });

    const result = await Promise.race([waitForExit, timeout]);
    if (!result.timeout) {
      return result;
    }

    child.kill("SIGKILL");
    const forcedResult = await waitForExit;
    return { ...forcedResult, forced: true };
  }
}
