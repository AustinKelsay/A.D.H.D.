import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import {
  normalizeOpenAIBaseUrl,
  resolveOrchestratorConfig,
} from '../lib/orchestrator-config.mjs';

const requiredTools = [
  { name: 'codex', required: true },
  { name: 'git', required: true },
  { name: 'gh', required: false },
];

const moduleConfig = {
  profiles: ['basic', 'edit', 'git', 'release'],
  schemaVersion: process.env.ADHD_SCHEMA_VERSION || '0.1.0',
  maxConcurrentSessions: Number(process.env.ADHD_MAX_CONCURRENT_SESSIONS || 3),
};

function commandExists(command) {
  if (typeof Bun !== 'undefined' && Bun?.which) {
    return !!Bun.which(command);
  }

  const isWindows = process.platform === 'win32';
  const candidates = isWindows ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command] : [command];
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const entry of pathEntries) {
    for (const candidate of candidates) {
      const candidatePath = path.join(entry, candidate);
      try {
        accessSync(candidatePath, constants.X_OK);
        return true;
      } catch {
        // continue searching
      }
    }
  }

  return false;
}

function readJSON(bodyText) {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

function sanitizeHeaders(apiKey) {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

async function checkOrchestrator() {
  const orchestratorConfig = resolveOrchestratorConfig();
  const headers = sanitizeHeaders(orchestratorConfig.apiKey);
  const timeoutMs = Number(process.env.ADHD_ORCHESTRATOR_TIMEOUT_MS || 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `${normalizeOpenAIBaseUrl(orchestratorConfig.baseUrl)}/models`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const body = await response.text().catch(() => '');
    const payload = readJSON(body);

    if (!response.ok) {
      const raw = payload?.message || body;
      return {
        tool: `orchestrator:${orchestratorConfig.provider}`,
        required: true,
        available: false,
        remediation: `${endpoint} responded ${response.status} ${response.statusText}. ${raw ? `${raw}` : 'verify key and endpoint permissions.'}`,
        details: {
          provider: orchestratorConfig.provider,
          baseUrl: orchestratorConfig.baseUrl,
          model: orchestratorConfig.model,
          status: response.status,
          statusText: response.statusText,
        },
      };
    }

    return {
      tool: `orchestrator:${orchestratorConfig.provider}`,
      required: true,
      available: true,
      details: {
        provider: orchestratorConfig.provider,
        baseUrl: orchestratorConfig.baseUrl,
        model: orchestratorConfig.model,
      },
      remediation: null,
    };
  } catch (error) {
    return {
      tool: `orchestrator:${orchestratorConfig.provider}`,
      required: true,
      available: false,
      remediation: orchestratorConfig.invalid
        ? `Invalid orchestrator configuration for ${orchestratorConfig.provider}: missing base URL`
        : error.message,
      details: {
        provider: orchestratorConfig.provider,
        baseUrl: orchestratorConfig.baseUrl,
        model: orchestratorConfig.model,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runDiagnostic() {
  const toolChecks = requiredTools.map((tool) => {
    const found = commandExists(tool.name);
    return {
      tool: tool.name,
      required: tool.required,
      available: found,
      remediation: found ? null : `install or add ${tool.name} to PATH`,
    };
  });
  const orchestratorCheck = await checkOrchestrator();
  const results = [...toolChecks, orchestratorCheck];
  const summary = {
    app: 'ADHD',
    mode: process.env.ADHD_HOST_MODE || 'desktop',
    schemaVersion: moduleConfig.schemaVersion,
    maxConcurrentSessions: moduleConfig.maxConcurrentSessions,
    ready: results.every((result) => (result.required ? result.available : true)),
    checks: results,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ready ? 0 : 1);
}

runDiagnostic();
