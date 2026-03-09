// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

import { bootstrapDesktopClient } from "./desktop-app";

const {
  readHealth,
  listHosts,
  listJobs,
  readJob,
  readLive,
  readResult,
  createJob,
  startJob,
  interruptJob,
  retryJob,
  approveRequest,
  rejectRequest
} = vi.hoisted(() => ({
  readHealth: vi.fn(),
  listHosts: vi.fn(),
  listJobs: vi.fn(),
  readJob: vi.fn(),
  readLive: vi.fn(),
  readResult: vi.fn(),
  createJob: vi.fn(),
  startJob: vi.fn(),
  interruptJob: vi.fn(),
  retryJob: vi.fn(),
  approveRequest: vi.fn(),
  rejectRequest: vi.fn()
}));

vi.mock("./backend-transport", () => ({
  readHealth
}));

vi.mock("./federation-client", () => ({
  listHosts,
  listJobs,
  readJob,
  readLive,
  readResult,
  createJob,
  startJob,
  interruptJob,
  retryJob,
  approveRequest,
  rejectRequest
}));

describe("bootstrapDesktopClient", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="app"></div>`;
    vi.clearAllMocks();

    readHealth.mockResolvedValue({
      ok: true,
      status: 200,
      checkedAt: new Date().toISOString(),
      summary: "ok",
      details: { ok: true }
    });
    listHosts.mockResolvedValue([
      {
        hostId: "h_alpha01",
        displayName: "Alpha",
        heartbeat: { status: "online" },
        workflow: { status: "loaded" }
      }
    ]);
    listJobs.mockResolvedValue([
      {
        jobId: "j_phase12_001",
        hostId: "h_alpha01",
        state: "queued",
        inputText: "Build the desktop client",
        timestamps: { updatedAt: "2026-03-09T00:00:00.000Z" }
      }
    ]);
    readJob.mockResolvedValue({
      hostId: "h_alpha01",
      job: {
        jobId: "j_phase12_001",
        hostId: "h_alpha01",
        state: "queued",
        inputText: "Build the desktop client",
        plan: { delegation: { selectedMode: "fallback_workers" } },
        timestamps: { updatedAt: "2026-03-09T00:00:00.000Z" }
      }
    });
    readLive.mockResolvedValue({
      hostId: "h_alpha01",
      job: {
        jobId: "j_phase12_001"
      },
      pendingApprovals: [
        {
          requestId: 77,
          method: "approval/request"
        }
      ]
    });
    readResult.mockResolvedValue({
      hostId: "h_alpha01",
      resultSummary: "Done",
      artifactPaths: ["artifacts/report.md"]
    });
    createJob.mockResolvedValue({
      hostId: "h_alpha01",
      job: {
        jobId: "j_phase12_created"
      }
    });
  });

  test("renders jobs and job detail", async () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing root");
    }

    await bootstrapDesktopClient(root);

    expect(root.textContent).toContain("ADHD Desktop Client");
    expect(root.textContent).toContain("Build the desktop client");

    const firstJobButton = root.querySelector<HTMLElement>("[data-job-id='j_phase12_001']");
    firstJobButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain("approval/request");
    expect(root.textContent).toContain("artifacts/report.md");
  });

  test("creates jobs from intake form", async () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing root");
    }

    await bootstrapDesktopClient(root);

    const textarea = root.querySelector<HTMLTextAreaElement>("#intake-text");
    textarea!.value = "Create the next desktop task";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));

    const createButton = root.querySelector<HTMLButtonElement>("#create-job");
    createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(createJob).toHaveBeenCalledWith({
      hostId: "h_alpha01",
      inputText: "Create the next desktop task",
      autoStart: true
    });
  });
});
