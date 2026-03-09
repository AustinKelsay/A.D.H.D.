export type EndpointConfig = {
  label: string;
  baseUrl: string;
  healthPath: string;
};

function readMetaOverride(name: string): string | null {
  const value = document
    .querySelector(`meta[name="${name}"]`)
    ?.getAttribute("content")
    ?.trim();
  return value || null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function createDefaultEndpoints(): EndpointConfig[] {
  const hostBaseUrl = normalizeBaseUrl(
    readMetaOverride("adhd-host-base-url") || "http://127.0.0.1:8787"
  );
  const federationBaseUrl = normalizeBaseUrl(
    readMetaOverride("adhd-federation-base-url") || "http://127.0.0.1:8788"
  );

  return [
    {
      label: "Host API",
      baseUrl: hostBaseUrl,
      healthPath: "/health"
    },
    {
      label: "Federation API",
      baseUrl: federationBaseUrl,
      healthPath: "/health"
    }
  ];
}
