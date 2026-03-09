export type ServiceName = "host" | "federation";

export type EndpointConfig = {
  label: string;
  baseUrl: string;
  healthPath: string;
};

export type HostRecord = {
  hostId: string;
  displayName?: string | null;
  auth?: {
    status?: string | null;
  } | null;
  heartbeat?: {
    status?: string | null;
    lastSeenAt?: string | null;
  } | null;
  workflow?: {
    status?: string | null;
    contentHash?: string | null;
  } | null;
  compatibility?: {
    status?: string | null;
  } | null;
};

export type JobRecord = {
  jobId: string;
  hostId?: string | null;
  state?: string | null;
  inputText?: string | null;
  resultSummary?: string | null;
  artifactPaths?: string[];
  timestamps?: {
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
  intake?: {
    mode?: string | null;
    source?: string | null;
  } | null;
  plan?: {
    delegation?: {
      selectedMode?: string | null;
    } | null;
  } | null;
};

export type ApprovalRecord = {
  requestId: number | string;
  jobId?: string | null;
  method?: string | null;
};

export type HealthSnapshot = {
  endpoint: EndpointConfig;
  ok: boolean;
  status: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  checkedAt: string;
};

export type TransportRequest = {
  service: ServiceName;
  method: "GET" | "POST";
  path: string;
  baseUrl?: string | null;
  body?: Record<string, unknown> | null;
};

export type TransportResponse<T = Record<string, unknown> | null> = {
  ok: boolean;
  status: number;
  body: T;
};
