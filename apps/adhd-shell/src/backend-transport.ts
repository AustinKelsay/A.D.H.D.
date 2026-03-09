import type {
  EndpointConfig,
  ServiceName,
  TransportRequest,
  TransportResponse
} from "./types";

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function toProxyPath(service: ServiceName, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/__adhd__/${service}${normalizedPath}`;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function readTauriInvoke(): Promise<TauriInvoke> {
  const module = await import("@tauri-apps/api/core");
  return module.invoke;
}

async function fetchBrowser(request: TransportRequest): Promise<TransportResponse> {
  const response = await fetch(toProxyPath(request.service, request.path), {
    method: request.method,
    headers: request.body
      ? {
          "content-type": "application/json"
        }
      : undefined,
    body: request.body ? JSON.stringify(request.body) : undefined
  });

  const body = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

async function fetchTauri(request: TransportRequest): Promise<TransportResponse> {
  const invoke = await readTauriInvoke();
  return invoke<TransportResponse>("backend_request", {
    service: request.service,
    method: request.method,
    path: request.path,
    baseUrl: request.baseUrl ?? null,
    body: request.body ?? null
  });
}

export async function backendRequest(request: TransportRequest): Promise<TransportResponse> {
  if (isTauriRuntime()) {
    return fetchTauri(request);
  }
  return fetchBrowser(request);
}

export async function readHealth(endpoint: EndpointConfig): Promise<{
  ok: boolean;
  status: number | null;
  checkedAt: string;
  summary: string;
  details: Record<string, unknown> | null;
}> {
  const checkedAt = new Date().toISOString();

  try {
    const service = endpoint.label === "Host API" ? "host" : "federation";
    const response = await backendRequest({
      service,
      method: "GET",
      path: endpoint.healthPath,
      baseUrl: endpoint.baseUrl
    });
    const payload =
      response.body && typeof response.body === "object"
        ? (response.body as Record<string, unknown>)
        : null;
    return {
      ok: response.status === 200 && payload?.ok === true,
      status: response.status,
      checkedAt,
      summary:
        response.status === 200 && payload?.ok === true
          ? "Ready to inspect backend health."
          : `Health check failed with status ${response.status}.`,
      details: payload
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      checkedAt,
      summary: error instanceof Error ? error.message : "Health check failed.",
      details: null
    };
  }
}
