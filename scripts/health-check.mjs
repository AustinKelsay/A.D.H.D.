#!/usr/bin/env node
import os from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";

const REQUIRED_CODEX_SUBCOMMANDS = [
  ["app-server", "--help"],
  ["mcp", "--help"],
  ["mcp-server", "--help"]
];

function run(cmd, args = []) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    ok: result.status === 0,
    code: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error?.message || null
  };
}

function parseFeatures(stdout) {
  const entries = {};
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("WARNING:")) {
      continue;
    }

    const match = trimmed.match(/^(\S+)\s{2,}(.+?)\s{2,}(true|false)$/);
    if (!match) {
      continue;
    }

    entries[match[1]] = {
      stage: match[2].trim(),
      enabled: match[3] === "true"
    };
  }
  return entries;
}

function parseArgs(argv) {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : "host";
  if (!["host", "control-plane", "both"].includes(mode)) {
    throw new Error(`Invalid --mode value: ${mode}`);
  }
  return { mode };
}

function checkCodexSubcommands() {
  return REQUIRED_CODEX_SUBCOMMANDS.map((args) => {
    const out = run("codex", args);
    const label = `codex ${args.join(" ")}`;
    return {
      id: `cmd.${args[0]}`,
      required: true,
      ok: out.ok,
      command: label,
      error: out.ok ? null : out.stderr || out.error || `exit ${out.code}`
    };
  });
}

function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const checks = [];

  const codexVersionCheck = run("codex", ["--version"]);
  checks.push({
    id: "tool.codex",
    required: true,
    ok: codexVersionCheck.ok,
    command: "codex --version",
    error: codexVersionCheck.ok
      ? null
      : codexVersionCheck.stderr || codexVersionCheck.error || `exit ${codexVersionCheck.code}`
  });

  if (codexVersionCheck.ok) {
    checks.push(...checkCodexSubcommands());
  }

  const featuresCheck = run("codex", ["features", "list"]);
  checks.push({
    id: "feature.list",
    required: false,
    ok: featuresCheck.ok,
    command: "codex features list",
    error: featuresCheck.ok
      ? null
      : featuresCheck.stderr || featuresCheck.error || `exit ${featuresCheck.code}`
  });

  const features = featuresCheck.ok ? parseFeatures(featuresCheck.stdout) : {};

  const payload = {
    mode,
    checkedAt: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      node: process.version
    },
    capabilities: {
      codexVersion: codexVersionCheck.ok
        ? codexVersionCheck.stdout.replace(/^WARNING:.*\n?/gm, "")
        : null,
      subcommands: {
        appServer: checks.find((c) => c.id === "cmd.app-server")?.ok ?? false,
        mcp: checks.find((c) => c.id === "cmd.mcp")?.ok ?? false,
        mcpServer: checks.find((c) => c.id === "cmd.mcp-server")?.ok ?? false
      },
      features: {
        multi_agent: features.multi_agent || null
      }
    },
    checks
  };

  payload.ready = checks.every((c) => !c.required || c.ok);

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(payload.ready ? 0 : 1);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
