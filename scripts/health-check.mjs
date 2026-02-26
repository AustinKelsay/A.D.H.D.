import { spawnSync } from 'node:child_process';

const requiredTools = [
  { name: 'codex', required: true },
  { name: 'git', required: true },
  { name: 'gh', required: false },
];

const config = {
  profiles: ['basic', 'edit', 'git', 'release'],
  maxConcurrentSessions: Number(process.env.ADHD_MAX_CONCURRENT_SESSIONS || 3),
};

const ORCHESTRATOR_PROVIDERS = {
  ollama: {
    requiresApiKey: false,
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.1',
  },
  openai: {
    requiresApiKey: true,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  openrouter: {
    requiresApiKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  'maple-ai': {
    requiresApiKey: true,
    baseUrl: 'https://api.maple.ai/v1',
    model: 'default',
  },
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeOrchestratorProvider(value) {
  const provider = normalizeText(value || process.env.ADHD_ORCHESTRATOR_PROVIDER || 'ollama');
  if (provider === 'custom') return provider;
  return ORCHESTRATOR_PROVIDERS[provider] ? provider : 'ollama';
}

function resolveOrchestratorConfig() {
  const provider = normalizeOrchestratorProvider(process.env.ADHD_ORCHESTRATOR_PROVIDER);

  if (provider === 'custom') {
    return {
      provider,
      baseUrl: normalizeText(process.env.ADHD_ORCHESTRATOR_BASE_URL),
      model: normalizeText(process.env.ADHD_ORCHESTRATOR_MODEL || 'llama3.1'),
      apiKey: normalizeText(process.env.ADHD_ORCHESTRATOR_API_KEY),
      requiresApiKey: false,
      invalid: !normalizeText(process.env.ADHD_ORCHESTRATOR_BASE_URL),
    };
  }

  const defaults = ORCHESTRATOR_PROVIDERS[provider];
  const baseUrl = normalizeText(process.env.ADHD_ORCHESTRATOR_BASE_URL || defaults.baseUrl);
  const apiKey = normalizeText(process.env.ADHD_ORCHESTRATOR_API_KEY || '');
  return {
    provider,
    baseUrl,
    model: normalizeText(process.env.ADHD_ORCHESTRATOR_MODEL || defaults.model),
    apiKey,
    requiresApiKey: defaults.requiresApiKey,
    invalid: defaults.requiresApiKey && !apiKey,
  };
}

function commandExists(command) {
  const check = spawnSync('which', [command], { stdio: 'ignore' });
  return check.status === 0;
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

function normalizeOpenAIBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  const hasV1 = normalized.toLowerCase().endsWith('/v1');
  return hasV1 ? normalized : `${normalized}/v1`;
}

async function checkOrchestrator() {
  const config = resolveOrchestratorConfig();
  const headers = sanitizeHeaders(config.apiKey);
  const timeoutMs = Number(process.env.ADHD_ORCHESTRATOR_TIMEOUT_MS || 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `${normalizeOpenAIBaseUrl(config.baseUrl)}/models`;

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
        tool: `orchestrator:${config.provider}`,
        required: true,
        available: false,
        remediation: `${endpoint} responded ${response.status} ${response.statusText}. ${raw ? `${raw}` : 'verify key and endpoint permissions.'}`,
        details: {
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
          status: response.status,
          statusText: response.statusText,
        },
      };
    }

    return {
      tool: `orchestrator:${config.provider}`,
      required: true,
      available: true,
      details: {
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model,
      },
      remediation: null,
    };
  } catch (error) {
    return {
      tool: `orchestrator:${config.provider}`,
      required: true,
      available: false,
      remediation: config.invalid
        ? `Invalid orchestrator configuration for ${config.provider}: missing base URL`
        : error.message,
      details: {
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model,
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
    schemaVersion: config.schemaVersion || '0.1.0',
    maxConcurrentSessions: config.maxConcurrentSessions,
    ready: results.every((result) => (result.required ? result.available : true)),
    checks: results,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ready ? 0 : 1);
}

runDiagnostic();
