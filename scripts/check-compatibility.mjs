#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = process.cwd();
const COMPAT_DIR = path.join(REPO_ROOT, "compatibility");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadLatest() {
  const latestPath = path.join(COMPAT_DIR, "latest.json");
  if (!fs.existsSync(latestPath)) {
    throw new Error("Missing compatibility/latest.json. Run: npm run compat:snapshot");
  }
  return readJson(latestPath);
}

function main() {
  const latest = loadLatest();
  const methodsPath = path.join(REPO_ROOT, latest.methodsFile || "");
  const manifestPath = path.join(COMPAT_DIR, "compatibility-manifest.json");
  const requiredMethodsPath = path.join(COMPAT_DIR, "required-methods.json");

  if (!fs.existsSync(methodsPath)) {
    throw new Error(`Missing methods file: ${methodsPath}`);
  }
  if (!fs.existsSync(requiredMethodsPath)) {
    throw new Error(`Missing required methods file: ${requiredMethodsPath}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing compatibility manifest file: ${manifestPath}`);
  }

  const methods = new Set(readJson(methodsPath).methods || []);
  const requiredMethods = readJson(requiredMethodsPath).requiredMethods || [];
  const manifest = readJson(manifestPath);

  const missingMethods = requiredMethods.filter((method) => !methods.has(method));

  const requiredNotificationFamilies = manifest.requiredNotificationFamilies || [];
  const missingFamilies = requiredNotificationFamilies.filter(
    (prefix) => ![...methods].some((method) => method.startsWith(prefix))
  );

  const requiredNotificationMethods = manifest.requiredNotificationMethods || [];
  const missingNotificationMethods = requiredNotificationMethods.filter((method) => !methods.has(method));

  const ok =
    missingMethods.length === 0 &&
    missingFamilies.length === 0 &&
    missingNotificationMethods.length === 0;

  const payload = {
    ok,
    codexVersion: latest.codexVersion,
    checkedAt: new Date().toISOString(),
    methodsFile: latest.methodsFile,
    schemaFile: latest.schemaFile,
    missingMethods,
    missingNotificationFamilies: missingFamilies,
    missingNotificationMethods
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
}

main();
