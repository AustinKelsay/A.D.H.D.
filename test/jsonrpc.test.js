import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import { JsonRpcClient, JsonRpcStreamDecoder, encodeJsonRpcMessage } from "../src/runtime/codex/jsonrpc.js";

test("decoder parses content-length framed message", () => {
  const decoder = new JsonRpcStreamDecoder();
  const seen = [];
  decoder.on("message", (m) => seen.push(m));

  const frame = encodeJsonRpcMessage({ jsonrpc: "2.0", method: "thread/started", params: {} });
  decoder.push(frame);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "thread/started");
});

test("decoder parses newline message", () => {
  const decoder = new JsonRpcStreamDecoder();
  const seen = [];
  decoder.on("message", (m) => seen.push(m));

  decoder.push(Buffer.from('{"jsonrpc":"2.0","method":"turn/started","params":{}}\n', "utf8"));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "turn/started");
});

test("request/response roundtrip", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const client = new JsonRpcClient({ input, output, requestTimeoutMs: 1000 });

  const requestPromise = client.sendRequest("initialize", { a: 1 });

  const chunks = [];
  output.on("data", (chunk) => chunks.push(chunk));

  await new Promise((resolve) => setTimeout(resolve, 10));
  const written = Buffer.concat(chunks).toString("utf8");
  const body = written.split("\r\n\r\n")[1];
  const request = JSON.parse(body);

  input.write(
    encodeJsonRpcMessage({
      jsonrpc: "2.0",
      id: request.id,
      result: { ok: true }
    })
  );

  const result = await requestPromise;
  assert.deepEqual(result, { ok: true });

  client.close();
});
