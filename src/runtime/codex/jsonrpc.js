import { EventEmitter } from "node:events";
import { RuntimeError } from "../errors.js";

function toBuffer(data) {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  return Buffer.from(data);
}

function extractContentLength(header) {
  const match = header.match(/content-length\s*:\s*(\d+)/i);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function looksLikeJson(text) {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function encodeJsonRpcMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  return Buffer.concat([header, body]);
}

export class JsonRpcStreamDecoder extends EventEmitter {
  constructor() {
    super();
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, toBuffer(chunk)]);

    while (this.buffer.length > 0) {
      const consumedFramed = this.consumeFramedMessage();
      if (consumedFramed) {
        continue;
      }

      const consumedLine = this.consumeLineMessage();
      if (consumedLine) {
        continue;
      }

      break;
    }
  }

  consumeFramedMessage() {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd <= 0) {
      return false;
    }

    const header = this.buffer.slice(0, headerEnd).toString("utf8");
    const contentLength = extractContentLength(header);
    if (contentLength === null) {
      return false;
    }

    const frameSize = headerEnd + 4 + contentLength;
    if (this.buffer.length < frameSize) {
      return false;
    }

    const body = this.buffer.slice(headerEnd + 4, frameSize).toString("utf8");
    this.buffer = this.buffer.slice(frameSize);
    this.emitJson(body);
    return true;
  }

  consumeLineMessage() {
    const newlineIndex = this.buffer.indexOf(0x0a);
    if (newlineIndex < 0) {
      return false;
    }

    const line = this.buffer.slice(0, newlineIndex).toString("utf8");
    this.buffer = this.buffer.slice(newlineIndex + 1);

    if (!line.trim()) {
      return true;
    }

    if (!looksLikeJson(line)) {
      this.emit("parseError", {
        reason: "non-json-line",
        line
      });
      return true;
    }

    this.emitJson(line);
    return true;
  }

  emitJson(text) {
    try {
      const payload = JSON.parse(text);
      this.emit("message", payload);
    } catch (error) {
      this.emit("parseError", {
        reason: "invalid-json",
        error: error.message,
        payload: text
      });
    }
  }
}

export class JsonRpcClient extends EventEmitter {
  constructor({ input, output, requestTimeoutMs = 30000, outgoingMode = "framed" } = {}) {
    super();

    if (!input || !output) {
      throw new RuntimeError(
        "JSONRPC_STREAMS_REQUIRED",
        "Both input and output streams are required for JsonRpcClient"
      );
    }

    this.input = input;
    this.output = output;
    this.requestTimeoutMs = requestTimeoutMs;
    this.outgoingMode = outgoingMode;
    this.nextId = 1;
    this.pending = new Map();

    this.decoder = new JsonRpcStreamDecoder();
    this.decoder.on("message", (message) => this.handleMessage(message));
    this.decoder.on("parseError", (error) => this.emit("decodeError", error));

    this.input.on("data", (chunk) => this.decoder.push(chunk));
    this.input.on("error", (error) => this.emit("error", error));
    this.output.on("error", (error) => this.emit("error", error));
  }

  sendRequest(method, params = {}, { timeoutMs } = {}) {
    const id = this.nextId;
    this.nextId += 1;

    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    const effectiveTimeout = timeoutMs ?? this.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RuntimeError("JSONRPC_TIMEOUT", `Request timed out for method ${method}`, { id, method }));
      }, effectiveTimeout);

      this.pending.set(id, { resolve, reject, timer, method });
      this.writeMessage(message);
    });
  }

  sendNotification(method, params = {}) {
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      params
    });
  }

  sendResponse(id, result = {}) {
    this.writeMessage({
      jsonrpc: "2.0",
      id,
      result
    });
  }

  sendError(id, code = -32000, message = "Request rejected", data = undefined) {
    this.writeMessage({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data })
      }
    });
  }

  close() {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new RuntimeError("JSONRPC_CLOSED", "JsonRpcClient closed", { id }));
    }
    this.pending.clear();
  }

  writeMessage(message) {
    if (this.outgoingMode === "line") {
      this.output.write(`${JSON.stringify(message)}\n`);
    } else {
      const payload = encodeJsonRpcMessage(message);
      this.output.write(payload);
    }
    this.emit("sent", message);
  }

  handleMessage(message) {
    if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
      const isResponse = Object.prototype.hasOwnProperty.call(message, "result") ||
        Object.prototype.hasOwnProperty.call(message, "error");

      if (isResponse) {
        this.resolvePending(message);
        return;
      }
    }

    if (message && typeof message.method === "string") {
      if (Object.prototype.hasOwnProperty.call(message, "id")) {
        this.emit("request", message);
      } else {
        this.emit("notification", message);
      }
      return;
    }

    this.emit("decodeError", {
      reason: "unknown-message-shape",
      payload: message
    });
  }

  resolvePending(message) {
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.emit("decodeError", {
        reason: "unknown-response-id",
        payload: message
      });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(
        new RuntimeError("JSONRPC_ERROR_RESPONSE", message.error.message || "JSON-RPC error", {
          method: pending.method,
          id: message.id,
          error: message.error
        })
      );
      return;
    }

    pending.resolve(message.result);
  }
}
