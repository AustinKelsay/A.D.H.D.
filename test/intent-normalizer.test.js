import test from "node:test";
import assert from "node:assert/strict";

import { normalizeIntent } from "../src/intent/normalizer.js";
import { RuntimeError } from "../src/runtime/errors.js";

test("normalizeIntent returns deterministic intent object", () => {
  const intent = normalizeIntent({
    inputText: "  Refactor ./src/server/host-api.js and skip tests urgently  ",
    target: " ./src "
  });

  assert.equal(intent.contractVersion, "intent.v1");
  assert.equal(intent.workType, "refactor");
  assert.equal(intent.profileHint, "fallback_workers");
  assert.deepEqual(intent.paths, ["./src/server/host-api.js"]);
  assert.deepEqual(intent.constraints, ["high-priority", "tests-optional"]);
  assert.equal(intent.target, "./src");
});

test("normalizeIntent rejects missing input text", () => {
  assert.throws(
    () => normalizeIntent({ inputText: "   " }),
    (error) => error instanceof RuntimeError && error.code === "INVALID_INPUT"
  );
});

test("normalizeIntent does not mark tests optional for negated skip-tests phrase", () => {
  const intent = normalizeIntent({
    inputText: "Do not skip tests when refactoring ./src/server/host-api.js"
  });

  assert.equal(intent.constraints.includes("tests-optional"), false);
  assert.equal(intent.constraints.includes("respect-negative-instructions"), true);
});

test("normalizeIntent snapshots hostConstraints and metadata", () => {
  const hostConstraints = {
    hostId: "h_local",
    limits: { cpu: 2 }
  };
  const metadata = {
    labels: ["ops"]
  };

  const intent = normalizeIntent({
    inputText: "Fix bug in ./src/runtime/host-runtime.js",
    hostConstraints,
    metadata
  });

  hostConstraints.limits.cpu = 8;
  metadata.labels.push("after");
  assert.equal(intent.hostConstraints.limits.cpu, 2);
  assert.deepEqual(intent.metadata.labels, ["ops"]);

  intent.hostConstraints.limits.cpu = 16;
  intent.metadata.labels.push("intent-only");
  assert.equal(hostConstraints.limits.cpu, 8);
  assert.deepEqual(metadata.labels, ["ops", "after"]);
});
