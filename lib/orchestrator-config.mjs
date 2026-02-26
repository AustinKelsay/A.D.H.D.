export const ORCHESTRATOR_PROVIDERS = {
  ollama: {
    requiresApiKey: false,
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.1',
    chatPath: '/api/chat',
    modelsPath: '/api/tags',
  },
  openai: {
    requiresApiKey: true,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    chatPath: '/chat/completions',
    modelsPath: '/models',
  },
  openrouter: {
    requiresApiKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    chatPath: '/chat/completions',
    modelsPath: '/models',
  },
  'maple-ai': {
    requiresApiKey: true,
    baseUrl: 'https://api.maple.ai/v1',
    model: 'default',
    chatPath: '/chat/completions',
    modelsPath: '/models',
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

export function buildOrchestratorEndpoint(config = {}, route = '') {
  const provider = normalizeText(config.provider || 'ollama');
  const base = provider === 'ollama'
    ? String(config.baseUrl || '').trim().replace(/\/+$/, '')
    : normalizeOpenAIBaseUrl(config.baseUrl);
  const path = String(route || '').trim().replace(/^\/+/, '');
  if (!base || !path) return base;
  const lowerBase = base.toLowerCase();
  const lowerPath = path.toLowerCase();
  if (lowerBase.endsWith('/v1') && lowerPath.startsWith('v1/')) {
    return `${base}/${path.slice(4)}`;
  }
  if (lowerBase.endsWith('/api') && lowerPath.startsWith('api/')) {
    return `${base}/${path.slice(4)}`;
  }
  return `${base}/${path}`;
}

export function buildOrchestratorHeaders(config = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };

  const apiKey = normalizeText(config.apiKey || '');
  const provider = normalizeText(config.provider || '');

  if (!apiKey) return headers;

  headers.Authorization = `Bearer ${apiKey}`;

  if (provider === 'openrouter' && !headers['HTTP-Referer']) {
    const referer = normalizeText(
      process.env.ADHD_OPENROUTER_REFERER ||
        process.env.ADHD_ORCHESTRATOR_OPENROUTER_REFERER ||
        '',
    );
    if (referer) headers['HTTP-Referer'] = referer;
  }

  if (provider === 'openrouter' && !headers['X-Title']) {
    const title = normalizeText(
      process.env.ADHD_OPENROUTER_TITLE ||
        process.env.ADHD_ORCHESTRATOR_OPENROUTER_TITLE ||
        'ADHD',
    );
    if (title) headers['X-Title'] = title;
  }

  if (provider === 'maple-ai') {
    const headerName = normalizeText(process.env.ADHD_MAPLE_AI_AUTH_HEADER || 'X-API-Key');
    if (headerName) {
      headers[headerName] = apiKey;
    }
  }

  if (provider === 'custom' && process.env.ADHD_ORCHESTRATOR_CUSTOM_AUTH_HEADER) {
    const headerName = normalizeText(process.env.ADHD_ORCHESTRATOR_CUSTOM_AUTH_HEADER);
    if (headerName) {
      headers[headerName] = apiKey;
    }
  }

  return headers;
}

export function resolveOrchestratorConfig() {
  const provider = normalizeOrchestratorProvider(process.env.ADHD_ORCHESTRATOR_PROVIDER);

  if (provider === 'custom') {
    const baseUrl = normalizeText(process.env.ADHD_ORCHESTRATOR_BASE_URL || '');
    const model = normalizeText(process.env.ADHD_ORCHESTRATOR_MODEL || '');
    const chatPath = normalizeText(process.env.ADHD_ORCHESTRATOR_CHAT_PATH || '/chat/completions');
    const modelsPath = normalizeText(process.env.ADHD_ORCHESTRATOR_MODELS_PATH || '/models');
    const apiKey = normalizeText(process.env.ADHD_ORCHESTRATOR_API_KEY || '');
    const invalidReason = !baseUrl ? 'missing base URL' : null;

    return {
      provider,
      baseUrl,
      chatPath,
      modelsPath,
      model: model || 'llama3.1',
      apiKey,
      requiresApiKey: false,
      invalid: !!invalidReason,
      invalidReason,
    };
  }

  const defaults = ORCHESTRATOR_PROVIDERS[provider];
  const baseUrl = normalizeText(process.env.ADHD_ORCHESTRATOR_BASE_URL || defaults.baseUrl);
  const model = normalizeText(process.env.ADHD_ORCHESTRATOR_MODEL || defaults.model);
  const chatPath = normalizeText(process.env.ADHD_ORCHESTRATOR_CHAT_PATH || defaults.chatPath);
  const modelsPath = normalizeText(process.env.ADHD_ORCHESTRATOR_MODELS_PATH || defaults.modelsPath);
  const apiKey = normalizeText(process.env.ADHD_ORCHESTRATOR_API_KEY || '');
  const missingApiKey = Boolean(defaults.requiresApiKey && !apiKey);
  const invalidReason = !baseUrl
    ? 'missing base URL'
    : missingApiKey
      ? `missing API key for provider '${provider}'`
      : null;

  return {
    provider,
    baseUrl,
    chatPath,
    modelsPath,
    model,
    apiKey,
    requiresApiKey: defaults.requiresApiKey,
    invalid: !!invalidReason,
    invalidReason,
    missingApiKey,
  };
}
