#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const appRoot = path.join(cwd, "apps", "adhd-shell");
const requiredFiles = [
  "apps/adhd-shell/package.json",
  "apps/adhd-shell/README.md",
  "apps/adhd-shell/index.html",
  "apps/adhd-shell/tsconfig.json",
  "apps/adhd-shell/vite.config.ts",
  "apps/adhd-shell/src/main.ts",
  "apps/adhd-shell/src/styles.css",
  "apps/adhd-shell/src/app-config.ts",
  "apps/adhd-shell/src/health-client.ts",
  "apps/adhd-shell/src-tauri/Cargo.toml",
  "apps/adhd-shell/src-tauri/build.rs",
  "apps/adhd-shell/src-tauri/icons/icon.png",
  "apps/adhd-shell/src-tauri/src/lib.rs",
  "apps/adhd-shell/src-tauri/src/main.rs",
  "apps/adhd-shell/src-tauri/tauri.conf.json",
  "apps/adhd-shell/src-tauri/capabilities/default.json",
  "llm/workflows/phase-11-tauri-shell-bootstrap.md"
];

const missing = requiredFiles.filter((relPath) => !fs.existsSync(path.join(cwd, relPath)));

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(cwd, relPath), "utf8"));
}

const checks = [];

for (const relPath of requiredFiles) {
  checks.push({
    id: `file:${relPath}`,
    ok: !missing.includes(relPath)
  });
}

if (missing.length === 0) {
  const packageJson = readJson("apps/adhd-shell/package.json");
  checks.push({
    id: "package:name",
    ok: packageJson.name === "@adhd/tauri-shell"
  });
  checks.push({
    id: "package:scripts",
    ok:
      typeof packageJson.scripts?.dev === "string" &&
      typeof packageJson.scripts?.build === "string" &&
      typeof packageJson.scripts?.["tauri:dev"] === "string"
  });

  const tauriConfig = readJson("apps/adhd-shell/src-tauri/tauri.conf.json");
  checks.push({
    id: "tauri:identifier",
    ok: tauriConfig.identifier === "com.adhd.shell"
  });
  checks.push({
    id: "tauri:frontend",
    ok:
      tauriConfig.build?.beforeDevCommand === "npm run dev" &&
      tauriConfig.build?.frontendDist === "../dist"
  });
  checks.push({
    id: "tauri:bundle-disabled",
    ok: tauriConfig.bundle?.active === false
  });

  const appConfigText = fs.readFileSync(path.join(appRoot, "src", "app-config.ts"), "utf8");
  checks.push({
    id: "app-config:host-default",
    ok: appConfigText.includes("8787")
  });
  checks.push({
    id: "app-config:federation-default",
    ok: appConfigText.includes("8788")
  });
}

const failed = checks.filter((check) => !check.ok).map((check) => check.id);
const payload = {
  ok: failed.length === 0 && missing.length === 0,
  checkedAt: new Date().toISOString(),
  missing,
  failed,
  checks
};

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
process.exit(payload.ok ? 0 : 1);
