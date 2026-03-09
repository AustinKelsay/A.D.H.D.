import type { EndpointConfig } from "./app-config";

export type HealthSnapshot = {
  endpoint: EndpointConfig;
  ok: boolean;
  status: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  checkedAt: string;
};

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });
  const body = await response.json().catch(() => null);
  return {
    status: response.status,
    body
  };
}

export async function readHealth(endpoint: EndpointConfig): Promise<HealthSnapshot> {
  const checkedAt = new Date().toISOString();
  try {
    const { status, body } = await fetchJson(`${endpoint.baseUrl}${endpoint.healthPath}`);
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const ok = status === 200 && payload?.ok === true;
    const summary = ok
      ? "Ready to inspect backend health."
      : `Health check failed with status ${status}.`;

    return {
      endpoint,
      ok,
      status,
      summary,
      details: payload,
      checkedAt
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: null,
      summary: error instanceof Error ? error.message : "Health check failed.",
      details: null,
      checkedAt
    };
  }
}
