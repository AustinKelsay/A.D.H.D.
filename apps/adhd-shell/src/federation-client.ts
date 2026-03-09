import { resolveServiceBaseUrl } from "./app-config";
import { backendRequest } from "./backend-transport";
import type { ApprovalRecord, HostRecord, JobRecord, TransportResponse } from "./types";

const federationBaseUrl = () => resolveServiceBaseUrl("federation");

function assertOk<T extends Record<string, unknown> | null>(
  response: TransportResponse<T>,
  context: string
): T {
  if (!response.ok) {
    const message =
      response.body && typeof response.body === "object"
        ? String((response.body as Record<string, unknown>)?.error?.message || context)
        : context;
    throw new Error(message);
  }
  return response.body;
}

export async function listHosts(): Promise<HostRecord[]> {
  const response = await backendRequest({
    service: "federation",
    method: "GET",
    path: "/api/hosts",
    baseUrl: federationBaseUrl()
  });
  const body = assertOk(response, "Failed to load hosts");
  return Array.isArray(body.hosts) ? (body.hosts as HostRecord[]) : [];
}

export async function listJobs(): Promise<JobRecord[]> {
  const response = await backendRequest({
    service: "federation",
    method: "GET",
    path: "/api/jobs",
    baseUrl: federationBaseUrl()
  });
  const body = assertOk(response, "Failed to load jobs");
  return Array.isArray(body.jobs) ? (body.jobs as JobRecord[]) : [];
}

export async function createJob(payload: {
  hostId: string;
  inputText: string;
  autoStart?: boolean;
}): Promise<{ hostId: string | null; job: JobRecord | null }> {
  const response = await backendRequest({
    service: "federation",
    method: "POST",
    path: "/api/jobs",
    baseUrl: federationBaseUrl(),
    body: payload
  });
  const body = assertOk(response, "Failed to create job");
  return {
    hostId: typeof body.hostId === "string" ? body.hostId : null,
    job: body.job && typeof body.job === "object" ? (body.job as JobRecord) : null
  };
}

export async function readJob(jobId: string): Promise<{ hostId: string | null; job: JobRecord | null }> {
  const response = await backendRequest({
    service: "federation",
    method: "GET",
    path: `/api/jobs/${encodeURIComponent(jobId)}`,
    baseUrl: federationBaseUrl()
  });
  const body = assertOk(response, `Failed to load job ${jobId}`);
  return {
    hostId: typeof body.hostId === "string" ? body.hostId : null,
    job: body.job && typeof body.job === "object" ? (body.job as JobRecord) : null
  };
}

export async function readLive(jobId: string): Promise<{
  hostId: string | null;
  job: JobRecord | null;
  pendingApprovals: ApprovalRecord[];
}> {
  const response = await backendRequest({
    service: "federation",
    method: "GET",
    path: `/api/jobs/${encodeURIComponent(jobId)}/live`,
    baseUrl: federationBaseUrl()
  });
  const body = assertOk(response, `Failed to load live state for ${jobId}`);
  return {
    hostId: typeof body.hostId === "string" ? body.hostId : null,
    job: body.job && typeof body.job === "object" ? (body.job as JobRecord) : null,
    pendingApprovals: Array.isArray(body.pendingApprovals)
      ? (body.pendingApprovals as ApprovalRecord[])
      : []
  };
}

export async function readResult(jobId: string): Promise<{
  hostId: string | null;
  resultSummary: string | null;
  artifactPaths: string[];
}> {
  const response = await backendRequest({
    service: "federation",
    method: "GET",
    path: `/api/jobs/${encodeURIComponent(jobId)}/result`,
    baseUrl: federationBaseUrl()
  });
  const body = assertOk(response, `Failed to load result for ${jobId}`);
  const result =
    body.result && typeof body.result === "object"
      ? (body.result as Record<string, unknown>)
      : null;
  return {
    hostId: typeof body.hostId === "string" ? body.hostId : null,
    resultSummary: typeof result?.resultSummary === "string" ? result.resultSummary : null,
    artifactPaths: Array.isArray(result?.artifactPaths)
      ? (result?.artifactPaths as string[])
      : []
  };
}

async function mutateJob(
  jobId: string,
  action: "start" | "interrupt" | "retry",
  body: Record<string, unknown> = {}
): Promise<JobRecord | null> {
  const response = await backendRequest({
    service: "federation",
    method: "POST",
    path: `/api/jobs/${encodeURIComponent(jobId)}/${action}`,
    baseUrl: federationBaseUrl(),
    body
  });
  const payload = assertOk(response, `Failed to ${action} job ${jobId}`);
  return payload.job && typeof payload.job === "object" ? (payload.job as JobRecord) : null;
}

export function startJob(jobId: string): Promise<JobRecord | null> {
  return mutateJob(jobId, "start");
}

export function interruptJob(jobId: string): Promise<JobRecord | null> {
  return mutateJob(jobId, "interrupt");
}

export function retryJob(jobId: string, startNow = false): Promise<JobRecord | null> {
  return mutateJob(jobId, "retry", { startNow });
}

export async function approveRequest(hostId: string, requestId: number | string): Promise<void> {
  const response = await backendRequest({
    service: "federation",
    method: "POST",
    path: `/api/approvals/${encodeURIComponent(String(requestId))}/approve`,
    baseUrl: federationBaseUrl(),
    body: {
      hostId,
      result: {
        approved: true
      }
    }
  });
  assertOk(response, `Failed to approve request ${requestId}`);
}

export async function rejectRequest(
  hostId: string,
  requestId: number | string,
  message: string
): Promise<void> {
  const response = await backendRequest({
    service: "federation",
    method: "POST",
    path: `/api/approvals/${encodeURIComponent(String(requestId))}/reject`,
    baseUrl: federationBaseUrl(),
    body: {
      hostId,
      message: message.trim() || "Rejected from desktop client"
    }
  });
  assertOk(response, `Failed to reject request ${requestId}`);
}
