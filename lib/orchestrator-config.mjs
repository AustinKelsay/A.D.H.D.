export const ORCHESTRATOR_PROVIDERS = {
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

export function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeOrchestratorProvider(value) {
  const provider = normalizeText(value || process.env.ADHD_ORCHESTRATOR_PROVIDER || 'ollama').toLowerCase();
  if (provider === 'custom') return provider;

  if (!ORCHESTRATOR_PROVIDERS[provider]) {
    throw new Error(
      `Invalid orchestrator provider '${provider}'. Valid providers: ${Object.keys(ORCHESTRATOR_PROVIDERS).join(', ')}`,
    );
  }

  return provider;
}

export function normalizeOpenAIBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  const hasV1 = normalized.toLowerCase().endsWith('/v1');
  return hasV1 ? normalized : `${normalized}/v1`;
}

export function resolveOrchestratorConfig() {
  const provider = normalizeOrchestratorProvider(process.env.ADHD_ORCHESTRATOR_PROVIDER);

  if (provider === 'custom') {
    const baseUrl = normalizeText(process.env.ADHD_ORCHESTRATOR_BASE_URL || '');
    const model = normalizeText(process.env.ADHD_ORCHESTRATOR_MODEL || '');
    const apiKey = normalizeText(process.env.ADHD_ORCHESTRATOR_API_KEY || '');

    return {
      provider,
      baseUrl,
      model: model || 'llama3.1',
      apiKey,
      requiresApiKey: false,
      invalid: !baseUrl,
    };
  }

  const defaults = ORCHESTRATOR_PROVIDERS[provider];
  const baseUrl = normalizeText(process.env.ADHD_ORCHESTRATOR_BASE_URL || defaults.baseUrl);
  const model = normalizeText(process.env.ADHD_ORCHESTRATOR_MODEL || defaults.model);
  const apiKey = normalizeText(process.env.ADHD_ORCHESTRATOR_API_KEY || '');

  return {
    provider,
    baseUrl,
    model,
    apiKey,
    requiresApiKey: defaults.requiresApiKey,
    invalid: false,
  };
}
