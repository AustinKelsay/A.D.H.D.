import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  approveRequest,
  createJob,
  listHosts,
  listJobs,
  rejectRequest,
  retryJob,
  startJob
} from "./federation-client";

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn()
}));

vi.mock("./backend-transport", () => ({
  backendRequest
}));

describe("federation-client", () => {
  beforeEach(() => {
    backendRequest.mockReset();
  });

  test("lists hosts from federation", async () => {
    backendRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: true,
        hosts: [{ hostId: "h_alpha01" }]
      }
    });

    await expect(listHosts()).resolves.toEqual([{ hostId: "h_alpha01" }]);
    expect(backendRequest).toHaveBeenCalledWith({
      service: "federation",
      method: "GET",
      path: "/api/hosts",
      baseUrl: "http://127.0.0.1:8788"
    });
  });

  test("creates jobs through the federation intake route", async () => {
    backendRequest.mockResolvedValue({
      ok: true,
      status: 201,
      body: {
        ok: true,
        hostId: "h_alpha01",
        job: {
          jobId: "j_phase12_001"
        }
      }
    });

    await expect(
      createJob({
        hostId: "h_alpha01",
        inputText: "Build desktop UI",
        autoStart: true
      })
    ).resolves.toEqual({
      hostId: "h_alpha01",
      job: {
        jobId: "j_phase12_001"
      }
    });
  });

  test("routes start and retry mutations", async () => {
    backendRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: true,
        job: {
          jobId: "j_phase12_001",
          state: "running"
        }
      }
    });

    await startJob("j_phase12_001");
    await retryJob("j_phase12_001", true);

    expect(backendRequest).toHaveBeenNthCalledWith(1, {
      service: "federation",
      method: "POST",
      path: "/api/jobs/j_phase12_001/start",
      baseUrl: "http://127.0.0.1:8788",
      body: {}
    });
    expect(backendRequest).toHaveBeenNthCalledWith(2, {
      service: "federation",
      method: "POST",
      path: "/api/jobs/j_phase12_001/retry",
      baseUrl: "http://127.0.0.1:8788",
      body: { startNow: true }
    });
  });

  test("routes approval actions with host awareness", async () => {
    backendRequest.mockResolvedValue({
      ok: true,
      status: 202,
      body: {
        ok: true
      }
    });

    await approveRequest("h_alpha01", 77);
    await rejectRequest("h_alpha01", 77, "deny");

    expect(backendRequest).toHaveBeenNthCalledWith(1, {
      service: "federation",
      method: "POST",
      path: "/api/approvals/77/approve",
      baseUrl: "http://127.0.0.1:8788",
      body: {
        hostId: "h_alpha01",
        result: {
          approved: true
        }
      }
    });
    expect(backendRequest).toHaveBeenNthCalledWith(2, {
      service: "federation",
      method: "POST",
      path: "/api/approvals/77/reject",
      baseUrl: "http://127.0.0.1:8788",
      body: {
        hostId: "h_alpha01",
        message: "deny"
      }
    });
  });

  test("lists jobs from the catalog route", async () => {
    backendRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: true,
        jobs: [{ jobId: "j_phase12_001" }]
      }
    });

    await expect(listJobs()).resolves.toEqual([{ jobId: "j_phase12_001" }]);
  });
});
