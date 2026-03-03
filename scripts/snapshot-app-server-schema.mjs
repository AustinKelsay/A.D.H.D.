#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();
const COMPAT_DIR = path.join(REPO_ROOT, "compatibility");
const TARGET_ROOT = path.join(COMPAT_DIR, "codex-app-server");
const REQUIRED_METHODS = [
  "initialize",
  "thread/start",
  "turn/start",
  "turn/interrupt",
  "thread/read"
];

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout || result.error?.message || result.status}`
    );
  }
  return (result.stdout || "").trim();
}

function sanitizeVersion(versionText) {
  const token = versionText.split(/\s+/).find((part) => /\d+\.\d+\.\d+/.test(part));
  if (!token) {
    throw new Error(`Unable to parse codex version from output: ${versionText}`);
  }
  return token.replace(/[^0-9A-Za-z._-]/g, "_");
}

function looksLikeMethodName(value) {
  if (value === "initialize") {
    return true;
  }
  return /^[a-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9._-]*)+$/.test(value);
}

function collectMethods(value, out) {
  if (typeof value === "string") {
    if (looksLikeMethodName(value)) {
      out.add(value);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (typeof value.method === "string") {
    out.add(value.method);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMethods(entry, out);
    }
    return;
  }

  for (const entry of Object.values(value)) {
    collectMethods(entry, out);
  }
}

function main() {
  fs.mkdirSync(TARGET_ROOT, { recursive: true });

  const versionRaw = run("codex", ["--version"]);
  const version = sanitizeVersion(versionRaw);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adhd-app-schema-"));
  run("codex", ["app-server", "generate-json-schema", "--out", tempDir]);

  const schemaPath = path.join(tempDir, "codex_app_server_protocol.schemas.json");
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const methods = new Set();
  collectMethods(schema, methods);

  const methodList = [...methods].sort();
  const targetDir = path.join(TARGET_ROOT, version);
  fs.mkdirSync(targetDir, { recursive: true });

  const targetSchemaPath = path.join(targetDir, "codex_app_server_protocol.schemas.json");
  const targetMethodsPath = path.join(targetDir, "methods.json");
  const targetMetadataPath = path.join(targetDir, "metadata.json");
  const latestPath = path.join(COMPAT_DIR, "latest.json");
  const requiredMethodsPath = path.join(COMPAT_DIR, "required-methods.json");

  fs.copyFileSync(schemaPath, targetSchemaPath);
  fs.writeFileSync(targetMethodsPath, `${JSON.stringify({ methods: methodList }, null, 2)}\n`);
  fs.writeFileSync(
    targetMetadataPath,
    `${JSON.stringify(
      {
        codexVersion: version,
        generatedAt: new Date().toISOString(),
        schemaFile: path.relative(REPO_ROOT, targetSchemaPath),
        methodCount: methodList.length
      },
      null,
      2
    )}\n`
  );

  if (!fs.existsSync(requiredMethodsPath)) {
    fs.writeFileSync(requiredMethodsPath, `${JSON.stringify({ requiredMethods: REQUIRED_METHODS }, null, 2)}\n`);
  }

  fs.writeFileSync(
    latestPath,
    `${JSON.stringify(
      {
        codexVersion: version,
        schemaFile: path.relative(REPO_ROOT, targetSchemaPath),
        methodsFile: path.relative(REPO_ROOT, targetMethodsPath),
        generatedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`
  );

  const missing = REQUIRED_METHODS.filter((method) => !methods.has(method));
  const payload = {
    ok: missing.length === 0,
    codexVersion: version,
    targetDir: path.relative(REPO_ROOT, targetDir),
    methodCount: methodList.length,
    missingRequiredMethods: missing
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(missing.length === 0 ? 0 : 1);
}

main();
