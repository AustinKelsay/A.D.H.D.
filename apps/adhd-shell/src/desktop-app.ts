import { createDefaultEndpoints } from "./app-config";
import { readHealth } from "./backend-transport";
import {
  approveRequest,
  createJob,
  interruptJob,
  listHosts,
  listJobs,
  readJob,
  readLive,
  readResult,
  rejectRequest,
  retryJob,
  startJob
} from "./federation-client";
import type { ApprovalRecord, HealthSnapshot, HostRecord, JobRecord } from "./types";

/* ─── State ────────────────────────────────────────────────────── */

type Toast = { id: number; message: string; type: "info" | "error" | "success" };

type AppState = {
  health: HealthSnapshot[];
  hosts: HostRecord[];
  jobs: JobRecord[];
  selectedHostId: string;
  selectedJobId: string | null;
  selectedJob: JobRecord | null;
  pendingApprovals: ApprovalRecord[];
  resultSummary: string | null;
  artifactPaths: string[];
  intakeText: string;
  autoStart: boolean;
  rejectionMessage: string;
  loading: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
  healthDrawerOpen: boolean;
  intakeOpen: boolean;
  detailTab: "approvals" | "results";
  toasts: Toast[];
  mobileView: "jobs" | "hosts" | "new" | "detail";
};

let toastCounter = 0;

/* ─── Helpers ──────────────────────────────────────────────────── */

function formatJson(value: Record<string, unknown> | null): string {
  return value ? JSON.stringify(value, null, 2) : "{}";
}

function stateTone(state: string | null | undefined): string {
  switch (state) {
    case "completed":
      return "ready";
    case "running":
    case "planning":
    case "delegating":
      return "live";
    case "failed":
    case "cancelled":
      return "blocked";
    default:
      return "neutral";
  }
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function hostDotClass(host: HostRecord): string {
  const status = host.heartbeat?.status;
  if (status === "online") return "online";
  if (status === "offline") return "offline";
  return "unknown";
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ─── Render: Health ───────────────────────────────────────────── */

function renderHealthDots(state: AppState): string {
  if (state.health.length === 0) {
    return `<div class="health-dots"><span class="health-dot unknown"></span></div>`;
  }
  const dots = state.health
    .map((s) => `<span class="health-dot ${s.ok ? "ok" : "err"}"></span>`)
    .join("");
  return `<div class="health-dots" data-action="toggle-health">${dots}</div>`;
}

function renderHealthDrawer(state: AppState): string {
  const openClass = state.healthDrawerOpen ? "open" : "";
  const cards = state.health
    .map((snapshot) => {
      const stateClass = snapshot.ok ? "ready" : "blocked";
      const statusLabel = snapshot.status === null ? "offline" : String(snapshot.status);
      return `
        <article class="health-card ${stateClass}">
          <header>
            <p class="eyebrow">${snapshot.endpoint.label}</p>
            <h2>${snapshot.ok ? "Connected" : "Unavailable"}</h2>
          </header>
          <dl class="fact-list">
            <div><dt>Base URL</dt><dd>${snapshot.endpoint.baseUrl}</dd></div>
            <div><dt>Status</dt><dd>${statusLabel}</dd></div>
            <div><dt>Checked</dt><dd>${new Date(snapshot.checkedAt).toLocaleTimeString()}</dd></div>
          </dl>
          <p class="summary">${snapshot.summary}</p>
          <pre>${formatJson(snapshot.details)}</pre>
        </article>
      `;
    })
    .join("");

  return `
    <div class="health-drawer ${openClass}">
      <div class="health-drawer__inner">${cards}</div>
    </div>
  `;
}

/* ─── Render: Sidebar ──────────────────────────────────────────── */

function renderIntake(state: AppState): string {
  const openClass = state.intakeOpen ? "open" : "";
  const toggleLabel = state.intakeOpen ? "Hide" : "+ New";
  return `
    <div class="sidebar__section">
      <div class="sidebar__section-header">
        <h3 class="sidebar__section-title">New Job</h3>
        <button class="sidebar__toggle" data-action="toggle-intake" type="button">${toggleLabel}</button>
      </div>
      <div class="intake-collapse ${openClass}">
        <div class="intake-form">
          <label class="field-stack">
            <span>Target host</span>
            <select id="host-select">
              ${state.hosts
                .map(
                  (host) => `
                    <option value="${host.hostId}" ${host.hostId === state.selectedHostId ? "selected" : ""}>
                      ${host.displayName || host.hostId}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label class="field-stack">
            <span>Task</span>
            <textarea id="intake-text" rows="3" placeholder="What do you want ADHD to do?">${escapeHtml(state.intakeText)}</textarea>
          </label>
          <label class="checkbox-row">
            <input id="auto-start" type="checkbox" ${state.autoStart ? "checked" : ""} />
            <span>Start immediately</span>
          </label>
          <button id="create-job" type="button">${state.loading ? '<span class="spinner"></span> Creating...' : "Create Job"}</button>
        </div>
      </div>
    </div>
  `;
}

function renderHosts(state: AppState): string {
  if (state.hosts.length === 0) {
    return `<p class="empty-state">No hosts online. They're probably vibing somewhere.</p>`;
  }

  return `
    <div class="host-list">
      ${state.hosts
        .map((host) => {
          const selected = host.hostId === state.selectedHostId ? "selected" : "";
          const dotClass = hostDotClass(host);
          return `
            <button class="host-chip ${selected}" data-host-id="${host.hostId}" type="button">
              <span class="host-dot ${dotClass}"></span>
              <strong>${host.displayName || host.hostId}</strong>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderJobs(state: AppState): string {
  if (state.jobs.length === 0) {
    return `<div class="job-list"><p class="empty-state">No jobs yet. Throw something at the wall.</p></div>`;
  }

  return `
    <div class="job-list">
      ${state.jobs
        .map((job) => {
          const selected = job.jobId === state.selectedJobId ? "selected" : "";
          const tone = stateTone(job.state);
          const time = relativeTime(job.timestamps?.updatedAt);
          return `
            <button class="job-row ${selected}" data-job-id="${job.jobId}" type="button">
              <span class="job-row__top">
                <span class="job-title">${job.inputText || job.jobId}</span>
                <span class="badge ${tone}">${job.state || "unknown"}</span>
              </span>
              <span class="job-row__bottom">
                <span>${job.hostId || "no host"}</span>
                <span>${time}</span>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSidebar(state: AppState): string {
  const mobileHidden =
    state.mobileView === "detail" ? "mobile-hidden" : "";
  return `
    <aside class="sidebar ${mobileHidden}">
      ${renderIntake(state)}

      <div class="sidebar__section">
        <div class="sidebar__section-header">
          <h3 class="sidebar__section-title">Hosts</h3>
        </div>
        ${renderHosts(state)}
      </div>

      <div class="sidebar__section" style="flex:0">
        <div class="sidebar__section-header">
          <h3 class="sidebar__section-title">Jobs</h3>
        </div>
      </div>
      <div class="jobs-scroll">
        ${renderJobs(state)}
      </div>
    </aside>
  `;
}

/* ─── Render: Detail ───────────────────────────────────────────── */

function renderApprovals(state: AppState): string {
  if (!state.selectedJob) {
    return `<p class="empty-state">Select a job to inspect approvals.</p>`;
  }
  if (state.pendingApprovals.length === 0) {
    return `<div class="empty-state"><p class="empty-state__title">All clear</p><p>No approvals waiting. You're good.</p></div>`;
  }

  return `
    <div class="approval-list">
      ${state.pendingApprovals
        .map(
          (approval) => `
            <article class="approval-card">
              <div class="approval-card__info">
                <p class="eyebrow">Request ${approval.requestId}</p>
                <strong>${approval.method || "approval/request"}</strong>
              </div>
              <div class="approval-card__actions">
                <button data-action="approve" data-request-id="${approval.requestId}" type="button">Approve</button>
                <button data-action="reject" data-request-id="${approval.requestId}" type="button" class="btn--ghost ghost">Reject</button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderResult(state: AppState): string {
  if (!state.selectedJob) {
    return `<p class="empty-state">Select a job to inspect result output.</p>`;
  }
  const artifacts =
    state.artifactPaths.length > 0
      ? `<ul class="artifact-list">${state.artifactPaths
          .map((artifact) => `<li>${artifact}</li>`)
          .join("")}</ul>`
      : `<div class="empty-state"><p class="empty-state__title">No artifacts</p><p>Nothing here yet.</p></div>`;

  return `
    <div class="result-panel">
      <p class="summary">${state.resultSummary || "No result summary yet."}</p>
      ${artifacts}
    </div>
  `;
}

function renderSelectedJob(state: AppState): string {
  const mobileHidden =
    state.mobileView !== "detail" && state.mobileView !== "jobs" ? "mobile-hidden" : "";

  if (!state.selectedJob) {
    return `
      <main class="content ${mobileHidden}">
        <article class="detail-card">
          <div class="detail-card__header">
            <div>
              <p class="eyebrow">Job Detail</p>
              <h2>Nothing selected</h2>
            </div>
          </div>
          <div class="detail-card__body">
            <div class="empty-state">
              <p class="empty-state__title">Nothing selected</p>
              <p>Pick a job from the sidebar, or create something new.</p>
            </div>
          </div>
        </article>
      </main>
    `;
  }

  const job = state.selectedJob;
  const approvalsCount = state.pendingApprovals.length;
  const approvalsTab = `Approvals${approvalsCount > 0 ? ` (${approvalsCount})` : ""}`;
  const approvalsActive = state.detailTab === "approvals" ? "active" : "";
  const resultsActive = state.detailTab === "results" ? "active" : "";

  return `
    <main class="content ${mobileHidden}">
      ${state.loading ? '<div class="detail-loading"></div>' : ""}
      <article class="detail-card">
        <div class="detail-card__header">
          <div>
            <button class="mobile-back" data-action="mobile-back" type="button">&larr; Back</button>
            <p class="eyebrow">Selected Job</p>
            <h2>${job.inputText || job.jobId}</h2>
          </div>
          <span class="badge ${stateTone(job.state)}">${job.state || "unknown"}</span>
        </div>
        <div class="detail-card__body">
          <dl class="fact-list compact">
            <div><dt>Job ID</dt><dd>${job.jobId}</dd></div>
            <div><dt>Host</dt><dd>${job.hostId || "unknown"}</dd></div>
            <div><dt>Mode</dt><dd>${job.plan?.delegation?.selectedMode || "unknown"}</dd></div>
            <div><dt>Updated</dt><dd>${job.timestamps?.updatedAt || "n/a"}</dd></div>
          </dl>
          <div class="button-row">
            <button data-action="start-job" type="button">Start</button>
            <button data-action="interrupt-job" type="button" class="btn--danger">Interrupt</button>
            <button data-action="retry-job" type="button" class="ghost">Retry</button>
            <button data-action="retry-start-job" type="button">Retry + Start</button>
            <button data-action="refresh-job" type="button" class="ghost">Refresh</button>
          </div>

          <div class="tab-bar">
            <button class="tab-bar__tab ${approvalsActive}" data-action="tab-approvals" type="button">${approvalsTab}</button>
            <button class="tab-bar__tab ${resultsActive}" data-action="tab-results" type="button">Results</button>
          </div>

          <div class="tab-panel ${state.detailTab === "approvals" ? "show-approvals" : "show-results"}">
            <section class="subsection tab-panel__approvals" style="margin-top:0;padding-top:0;border-top:0">
              <header class="subsection-header">
                <h3>Live approvals</h3>
                <label class="field-stack inline-field">
                  <span>Reject message</span>
                  <input id="rejection-message" value="${escapeHtml(state.rejectionMessage)}" />
                </label>
              </header>
              ${renderApprovals(state)}
            </section>
            <section class="subsection tab-panel__results" style="margin-top:0;padding-top:0;border-top:0">
              <header class="subsection-header">
                <h3>Result</h3>
              </header>
              ${renderResult(state)}
            </section>
          </div>
        </div>
      </article>
    </main>
  `;
}

/* ─── Render: Toasts ───────────────────────────────────────────── */

function renderToasts(state: AppState): string {
  if (state.toasts.length === 0) return "";
  return `
    <div class="toast-container">
      ${state.toasts
        .map(
          (t) => `<div class="toast ${t.type}" data-toast-id="${t.id}">${t.message}</div>`
        )
        .join("")}
    </div>
  `;
}

/* ─── Render: Mobile Bottom Nav ────────────────────────────────── */

function renderBottomNav(state: AppState): string {
  const items = [
    { view: "jobs" as const, label: "Jobs" },
    { view: "hosts" as const, label: "Hosts" },
    { view: "new" as const, label: "New" },
    { view: "detail" as const, label: "Detail" }
  ];
  return `
    <nav class="bottom-nav">
      <div class="bottom-nav__items">
        ${items
          .map(
            (item) =>
              `<button class="bottom-nav__item ${state.mobileView === item.view ? "active" : ""}" data-action="mobile-nav" data-mobile-view="${item.view}" type="button">${item.label}</button>`
          )
          .join("")}
      </div>
    </nav>
  `;
}

/* ─── Render: Shell ────────────────────────────────────────────── */

function renderShell(state: AppState): string {
  const statusClass = state.errorMessage ? "error" : "ok";
  const statusText = state.errorMessage || state.statusMessage || "Ready";

  return `
    <div class="shell">
      <header class="app-bar">
        <div class="app-bar__brand">
          <h1 class="app-bar__title">ADHD Desktop Client</h1>
          ${renderHealthDots(state)}
        </div>
        <div class="app-bar__right">
          <span class="status-badge ${statusClass}">${statusText}</span>
          <button id="refresh-all" type="button" class="btn--ghost ghost">${state.loading ? '<span class="spinner spinner--dark"></span>' : "Refresh"}</button>
        </div>
      </header>

      ${renderHealthDrawer(state)}

      <div class="app-body">
        ${renderSidebar(state)}
        ${renderSelectedJob(state)}
      </div>

      ${renderBottomNav(state)}
      ${renderToasts(state)}
    </div>
  `;
}

/* ─── Focus preservation ───────────────────────────────────────── */

function preserveFocus(root: HTMLElement, renderFn: () => void): void {
  const active = document.activeElement;
  const activeId = active instanceof HTMLElement ? active.id : null;
  const selectionStart =
    active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      ? active.selectionStart
      : null;
  const selectionEnd =
    active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      ? active.selectionEnd
      : null;

  renderFn();

  if (activeId) {
    const restored = root.querySelector<HTMLElement>(`#${activeId}`);
    if (restored) {
      restored.focus();
      if (
        selectionStart !== null &&
        (restored instanceof HTMLTextAreaElement || restored instanceof HTMLInputElement)
      ) {
        restored.selectionStart = selectionStart;
        restored.selectionEnd = selectionEnd;
      }
    }
  }
}

/* ─── State init ───────────────────────────────────────────────── */

function defaultState(): AppState {
  return {
    health: [],
    hosts: [],
    jobs: [],
    selectedHostId: "h_alpha01",
    selectedJobId: null,
    selectedJob: null,
    pendingApprovals: [],
    resultSummary: null,
    artifactPaths: [],
    intakeText: "",
    autoStart: true,
    rejectionMessage: "Rejected from desktop client",
    loading: false,
    statusMessage: "Booting up...",
    errorMessage: null,
    healthDrawerOpen: false,
    intakeOpen: true,
    detailTab: "approvals",
    toasts: [],
    mobileView: "jobs"
  };
}

async function loadHealth(): Promise<HealthSnapshot[]> {
  const endpoints = createDefaultEndpoints();
  return Promise.all(
    endpoints.map(async (endpoint) => ({
      endpoint,
      ...(await readHealth(endpoint))
    }))
  );
}

/* ─── Bootstrap ────────────────────────────────────────────────── */

export async function bootstrapDesktopClient(root: HTMLElement): Promise<void> {
  const state = defaultState();
  let refreshTimer = 0;

  const addToast = (message: string, type: Toast["type"] = "info") => {
    const id = ++toastCounter;
    state.toasts.push({ id, message, type });
    setTimeout(() => {
      state.toasts = state.toasts.filter((t) => t.id !== id);
      render();
    }, 4000);
  };

  const syncSelectedHost = () => {
    if (!state.hosts.some((host) => host.hostId === state.selectedHostId) && state.hosts[0]) {
      state.selectedHostId = state.hosts[0].hostId;
    }
  };

  const syncSelectedJob = () => {
    if (!state.jobs.some((job) => job.jobId === state.selectedJobId)) {
      state.selectedJobId = state.jobs[0]?.jobId || null;
    }
  };

  const loadSelection = async () => {
    if (!state.selectedJobId) {
      state.selectedJob = null;
      state.pendingApprovals = [];
      state.resultSummary = null;
      state.artifactPaths = [];
      return;
    }

    const [jobResponse, liveResponse, resultResponse] = await Promise.all([
      readJob(state.selectedJobId),
      readLive(state.selectedJobId),
      readResult(state.selectedJobId)
    ]);
    state.selectedJob = jobResponse.job;
    state.pendingApprovals = liveResponse.pendingApprovals;
    state.resultSummary = resultResponse.resultSummary;
    state.artifactPaths = resultResponse.artifactPaths;
  };

  const render = () => {
    preserveFocus(root, () => {
      root.innerHTML = renderShell(state);
    });

    const refreshButton = root.querySelector<HTMLButtonElement>("#refresh-all");
    const createButton = root.querySelector<HTMLButtonElement>("#create-job");
    const hostSelect = root.querySelector<HTMLSelectElement>("#host-select");
    const intakeText = root.querySelector<HTMLTextAreaElement>("#intake-text");
    const autoStart = root.querySelector<HTMLInputElement>("#auto-start");
    const rejectionMessage = root.querySelector<HTMLInputElement>("#rejection-message");

    refreshButton?.addEventListener("click", () => {
      void refreshAll();
    });

    hostSelect?.addEventListener("change", (event) => {
      state.selectedHostId = (event.target as HTMLSelectElement).value;
    });

    intakeText?.addEventListener("input", (event) => {
      state.intakeText = (event.target as HTMLTextAreaElement).value;
    });

    autoStart?.addEventListener("change", (event) => {
      state.autoStart = (event.target as HTMLInputElement).checked;
    });

    rejectionMessage?.addEventListener("input", (event) => {
      state.rejectionMessage = (event.target as HTMLInputElement).value;
    });

    createButton?.addEventListener("click", () => {
      void onCreateJob();
    });

    root.querySelectorAll<HTMLElement>("[data-host-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedHostId = button.dataset.hostId || state.selectedHostId;
        render();
      });
    });

    root.querySelectorAll<HTMLElement>("[data-job-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedJobId = button.dataset.jobId || null;
        state.mobileView = "detail";
        void refreshSelection();
      });
    });

    root.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action || "";
        const requestId = button.dataset.requestId || "";

        if (action === "toggle-health") {
          state.healthDrawerOpen = !state.healthDrawerOpen;
          render();
        } else if (action === "toggle-intake") {
          state.intakeOpen = !state.intakeOpen;
          render();
        } else if (action === "tab-approvals") {
          state.detailTab = "approvals";
          render();
        } else if (action === "tab-results") {
          state.detailTab = "results";
          render();
        } else if (action === "mobile-nav") {
          const view = button.dataset.mobileView as AppState["mobileView"];
          if (view) {
            state.mobileView = view;
            render();
          }
        } else if (action === "mobile-back") {
          state.mobileView = "jobs";
          render();
        } else {
          void onAction(action, requestId);
        }
      });
    });
  };

  const setMessage = (message: string, isError = false) => {
    if (isError) {
      state.errorMessage = message;
      state.statusMessage = null;
    } else {
      state.statusMessage = message;
      state.errorMessage = null;
    }
  };

  const refreshAll = async () => {
    state.loading = true;
    setMessage("Refreshing...");
    render();
    try {
      const [health, hosts, jobs] = await Promise.all([loadHealth(), listHosts(), listJobs()]);
      state.health = health;
      state.hosts = hosts;
      state.jobs = jobs.sort((a, b) =>
        String(b.timestamps?.updatedAt || "").localeCompare(String(a.timestamps?.updatedAt || ""))
      );
      syncSelectedHost();
      syncSelectedJob();
      await loadSelection();
      setMessage("Ready");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to refresh state.";
      setMessage(msg, true);
      addToast(msg, "error");
    } finally {
      state.loading = false;
      render();
    }
  };

  const refreshSelection = async () => {
    state.loading = true;
    render();
    try {
      await loadSelection();
      setMessage("Ready");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to refresh job detail.";
      setMessage(msg, true);
      addToast(msg, "error");
    } finally {
      state.loading = false;
      render();
    }
  };

  const onCreateJob = async () => {
    if (!state.intakeText.trim()) {
      setMessage("Task text is required before creating a job.", true);
      addToast("Task text is required.", "error");
      render();
      return;
    }

    state.loading = true;
    render();
    try {
      const created = await createJob({
        hostId: state.selectedHostId,
        inputText: state.intakeText.trim(),
        autoStart: state.autoStart
      });
      state.intakeText = "";
      state.selectedJobId = created.job?.jobId || null;
      state.intakeOpen = false;
      await refreshAll();
      const jobMsg = created.job?.jobId ? `Created ${created.job.jobId}.` : "Job created.";
      setMessage(jobMsg);
      addToast(jobMsg, "success");
      render();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to create job.";
      setMessage(msg, true);
      addToast(msg, "error");
      state.loading = false;
      render();
    }
  };

  const onAction = async (action: string, requestId: string) => {
    if (!state.selectedJobId && !requestId) {
      return;
    }

    state.loading = true;
    render();
    try {
      if (action === "start-job" && state.selectedJobId) {
        await startJob(state.selectedJobId);
        setMessage(`Started ${state.selectedJobId}.`);
        addToast("Job started.", "success");
      } else if (action === "interrupt-job" && state.selectedJobId) {
        await interruptJob(state.selectedJobId);
        setMessage(`Interrupted ${state.selectedJobId}.`);
        addToast("Job interrupted.", "info");
      } else if (action === "retry-job" && state.selectedJobId) {
        await retryJob(state.selectedJobId, false);
        setMessage(`Retried ${state.selectedJobId}.`);
        addToast("Job retried.", "success");
      } else if (action === "retry-start-job" && state.selectedJobId) {
        await retryJob(state.selectedJobId, true);
        setMessage(`Retried and started ${state.selectedJobId}.`);
        addToast("Job retried and started.", "success");
      } else if (action === "refresh-job") {
        await refreshSelection();
        return;
      } else if (action === "approve" && requestId && state.selectedJob?.hostId) {
        await approveRequest(state.selectedJob.hostId, requestId);
        setMessage(`Approved request ${requestId}.`);
        addToast("Request approved.", "success");
      } else if (action === "reject" && requestId && state.selectedJob?.hostId) {
        await rejectRequest(state.selectedJob.hostId, requestId, state.rejectionMessage);
        setMessage(`Rejected request ${requestId}.`);
        addToast("Request rejected.", "info");
      }
      await refreshAll();
      render();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to perform action.";
      setMessage(msg, true);
      addToast(msg, "error");
      state.loading = false;
      render();
    }
  };

  /* Keyboard shortcuts */
  const onKeyDown = (event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey;

    if (meta && event.key === "k") {
      event.preventDefault();
      state.intakeOpen = true;
      render();
      root.querySelector<HTMLTextAreaElement>("#intake-text")?.focus();
    } else if (meta && event.key === "r") {
      event.preventDefault();
      void refreshAll();
    } else if (event.key === "Escape") {
      state.selectedJobId = null;
      state.selectedJob = null;
      state.pendingApprovals = [];
      state.resultSummary = null;
      state.artifactPaths = [];
      state.mobileView = "jobs";
      render();
    } else if (
      (event.key === "j" || event.key === "k") &&
      !meta &&
      !(document.activeElement instanceof HTMLInputElement) &&
      !(document.activeElement instanceof HTMLTextAreaElement) &&
      !(document.activeElement instanceof HTMLSelectElement)
    ) {
      if (state.jobs.length === 0) return;
      const currentIdx = state.jobs.findIndex((j) => j.jobId === state.selectedJobId);
      let nextIdx: number;
      if (event.key === "j") {
        nextIdx = currentIdx < state.jobs.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : state.jobs.length - 1;
      }
      state.selectedJobId = state.jobs[nextIdx].jobId;
      state.mobileView = "detail";
      void refreshSelection();
    }
  };

  document.addEventListener("keydown", onKeyDown);

  await refreshAll();

  refreshTimer = window.setInterval(() => {
    if (state.selectedJobId && !state.loading) {
      void refreshSelection();
    }
  }, 5000);

  root.addEventListener(
    "DOMNodeRemoved",
    () => {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }
      document.removeEventListener("keydown", onKeyDown);
    },
    { once: true }
  );
}
