import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { RuntimeError, assert } from "../errors.js";

export const REQUIRED_METHODS = Object.freeze([
  "initialize",
  "thread/start",
  "turn/start",
  "turn/interrupt",
  "thread/read"
]);

export const APPROVAL_REQUEST_METHODS = Object.freeze([
  "item/tool/requestUserInput",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "execCommandApproval",
  "applyPatchApproval"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadAvailableMethods({ compatibilityDir = path.join(process.cwd(), "compatibility") } = {}) {
  const latestPath = path.join(compatibilityDir, "latest.json");
  if (!fs.existsSync(latestPath)) {
    throw new RuntimeError(
      "MISSING_COMPATIBILITY_BASELINE",
      "Missing compatibility/latest.json. Run `npm run compat:snapshot` first."
    );
  }

  const latest = readJson(latestPath);
  const methodsFile = latest.methodsFile;
  assert(methodsFile, "MISSING_METHODS_FILE", "latest.json missing methodsFile");

  const methodsPath = path.join(process.cwd(), methodsFile);
  if (!fs.existsSync(methodsPath)) {
    throw new RuntimeError("MISSING_METHODS_FILE", `Missing methods file: ${methodsPath}`);
  }

  const methods = readJson(methodsPath).methods || [];
  return new Set(methods);
}

export function assertRequiredMethods(availableMethods, requiredMethods = REQUIRED_METHODS) {
  const missing = requiredMethods.filter((method) => !availableMethods.has(method));
  if (missing.length > 0) {
    throw new RuntimeError("INCOMPATIBLE_APP_SERVER", "Required app-server methods are missing", {
      missing
    });
  }
}

export class CodexAppServerAdapter extends EventEmitter {
  constructor({ rpcClient, availableMethods = null } = {}) {
    super();
    assert(rpcClient, "MISSING_RPC_CLIENT", "rpcClient is required");

    this.rpcClient = rpcClient;
    this.availableMethods = availableMethods;

    if (this.availableMethods) {
      assertRequiredMethods(this.availableMethods);
    }

    this.rpcClient.on("notification", (message) => {
      this.emit("notification", message);
      this.emit(message.method, message.params);
    });

    this.rpcClient.on("request", (message) => {
      this.emit("request", message);
      if (APPROVAL_REQUEST_METHODS.includes(message.method)) {
        this.emit("approvalRequest", message);
      }
    });

    this.rpcClient.on("decodeError", (error) => this.emit("decodeError", error));
    this.rpcClient.on("error", (error) => this.emit("error", error));
  }

  async initialize({
    clientInfo = { name: "adhd-host", version: "0.1.0" },
    capabilities = {}
  } = {}) {
    return this.rpcClient.sendRequest("initialize", {
      clientInfo,
      capabilities
    });
  }

  initialized() {
    this.rpcClient.sendNotification("initialized", {});
  }

  async threadStart(params = {}) {
    return this.rpcClient.sendRequest("thread/start", params);
  }

  async turnStart({ threadId, input, ...rest }) {
    assert(threadId, "MISSING_THREAD_ID", "threadId is required for turn/start");
    assert(Array.isArray(input), "MISSING_INPUT", "input array is required for turn/start");

    return this.rpcClient.sendRequest("turn/start", {
      threadId,
      input,
      ...rest
    });
  }

  async turnInterrupt({ threadId, turnId }) {
    assert(threadId, "MISSING_THREAD_ID", "threadId is required for turn/interrupt");
    assert(turnId, "MISSING_TURN_ID", "turnId is required for turn/interrupt");

    return this.rpcClient.sendRequest("turn/interrupt", {
      threadId,
      turnId
    });
  }

  async threadRead({ threadId, includeTurns = false }) {
    assert(threadId, "MISSING_THREAD_ID", "threadId is required for thread/read");

    return this.rpcClient.sendRequest("thread/read", {
      threadId,
      includeTurns
    });
  }

  sendRequestResponse(id, result = {}) {
    this.rpcClient.sendResponse(id, result);
  }

  sendRequestError(id, message = "Request rejected", code = -32000, data = undefined) {
    this.rpcClient.sendError(id, code, message, data);
  }
}
