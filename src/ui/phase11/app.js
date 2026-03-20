const configElement = document.querySelector("#adhd-ui-config");
const bootConfig = configElement ? JSON.parse(configElement.textContent || "{}") : {};
const apiBase = typeof bootConfig.apiBase === "string" ? bootConfig.apiBase : "";
const pollIntervalMs = Number.isFinite(bootConfig.pollIntervalMs) ? bootConfig.pollIntervalMs : 5000;
const tokenStorageKey = "adhd.phase11.operatorToken";

const state = {
  token: window.localStorage.getItem(tokenStorageKey) || "",
  health: null,
  hosts: [],
  approvals: [],
  jobs: [],
  selectedJobId: null,
  selectedJob: null,
  selectedJobLive: null,
  selectedJobResult: null,
  selectedHostId: null,
  selectedHost: null,
  selectedHostMetrics: null,
  filters: {
    hostId: "",
    state: "",
    q: ""
  },
  autoRefresh: true,
  timerId: null,
  banner: "",
  bannerTone: "info",
  busyLabel: ""
};

const elements = {
  authForm: document.querySelector("#auth-form"),
  tokenInput: document.querySelector("#token-input"),
  clearTokenButton: document.querySelector("#clear-token-button"),
  connectionNote: document.querySelector("#connection-note"),
  autoRefreshInput: document.querySelector("#auto-refresh-input"),
  refreshButton: document.querySelector("#refresh-button"),
  summaryCards: document.querySelector("#summary-cards"),
  statusBanner: document.querySelector("#status-banner"),
  createJobForm: document.querySelector("#create-job-form"),
  createHostSelect: document.querySelector("#create-host-select"),
  createInputText: document.querySelector("#create-input-text"),
  createAutoStart: document.querySelector("#create-auto-start"),
  jobsFilterForm: document.querySelector("#jobs-filter-form"),
  filterHostSelect: document.querySelector("#filter-host-select"),
  filterStateSelect: document.querySelector("#filter-state-select"),
  filterQueryInput: document.querySelector("#filter-query-input"),
  jobsTable: document.querySelector("#jobs-table"),
  detailRefreshButton: document.querySelector("#detail-refresh-button"),
  jobDetail: document.querySelector("#job-detail"),
  hostsList: document.querySelector("#hosts-list"),
  approvalsList: document.querySelector("#approvals-list"),
  hostDetail: document.querySelector("#host-detail")
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    if (character === "&") {
      return "&amp;";
    }
    if (character === "<") {
      return "&lt;";
    }
    if (character === ">") {
      return "&gt;";
    }
    if (character === "\"") {
      return "&quot;";
    }
    return "&#39;";
  });
}

function readJson(response) {
  return response.text().then((rawText) => {
    if (!rawText.trim()) {
      return null;
    }
    try {
      return JSON.parse(rawText);
    } catch (error) {
      const snippet = rawText.length > 200 ? `${rawText.slice(0, 197)}...` : rawText;
      throw new Error(
        `Failed to parse JSON response: ${error?.message || "unknown parse error"}; body=${snippet}`
      );
    }
  });
}

async function apiFetch(path, { method = "GET", body = null } = {}) {
  const headers = {};
  if (state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }
  if (body !== null) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body === null ? null : JSON.stringify(body)
  });
  const payload = await readJson(response);

  if (!response.ok) {
    const message = payload?.error?.message || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function setBanner(message, tone = "info") {
  state.banner = message;
  state.bannerTone = tone;
  renderBanner();
}

function clearBanner() {
  state.banner = "";
  state.bannerTone = "info";
  renderBanner();
}

function renderBanner() {
  if (!state.banner) {
    elements.statusBanner.hidden = true;
    elements.statusBanner.textContent = "";
    elements.statusBanner.className = "status-banner";
    return;
  }

  elements.statusBanner.hidden = false;
  elements.statusBanner.textContent = state.banner;
  elements.statusBanner.className = `status-banner ${state.bannerTone === "danger" ? "danger" : ""}`;
}

function setBusy(label = "") {
  state.busyLabel = label;
  if (label) {
    elements.connectionNote.textContent = label;
    return;
  }

  const tokenState = state.token
    ? "Token saved for protected actions."
    : "Read-only routes work without a token unless your deployment enforces auth.";
  elements.connectionNote.textContent = tokenState;
}

function formatDate(value) {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function summarizeText(value, maxLength = 120) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) {
    return text || "Untitled job";
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

function chipClassForState(value) {
  if (["failed", "cancelled", "offline", "revoked"].includes(value)) {
    return "chip danger";
  }
  if (["awaiting_approval", "degraded", "warn"].includes(value)) {
    return "chip warning";
  }
  return "chip";
}

function setToken(token) {
  state.token = token.trim();
  if (state.token) {
    window.localStorage.setItem(tokenStorageKey, state.token);
  } else {
    window.localStorage.removeItem(tokenStorageKey);
  }
  elements.tokenInput.value = state.token;
  setBusy("");
}

function buildJobsPath() {
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (state.filters.hostId) {
    params.set("hostId", state.filters.hostId);
  }
  if (state.filters.state) {
    params.set("state", state.filters.state);
  }
  if (state.filters.q) {
    params.set("q", state.filters.q);
  }
  return `/api/jobs?${params.toString()}`;
}

async function refreshDashboard({ forceDetail = false } = {}) {
  setBusy("Refreshing operator console...");
  try {
    const [healthPayload, hostsPayload, approvalsPayload, jobsPayload] = await Promise.all([
      apiFetch("/health"),
      apiFetch("/api/hosts"),
      apiFetch("/api/approvals"),
      apiFetch(buildJobsPath())
    ]);

    state.health = healthPayload;
    state.hosts = Array.isArray(hostsPayload?.hosts) ? hostsPayload.hosts : [];
    state.approvals = Array.isArray(approvalsPayload?.approvals) ? approvalsPayload.approvals : [];
    state.jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];

    syncHostSelectors();

    if (!state.selectedJobId || !state.jobs.some((job) => job.jobId === state.selectedJobId) || forceDetail) {
      state.selectedJobId = state.jobs[0]?.jobId || null;
    }
    if (!state.selectedHostId || !state.hosts.some((host) => host.hostId === state.selectedHostId)) {
      state.selectedHostId = state.hosts[0]?.hostId || null;
    }

    await Promise.all([
      refreshSelectedJob(),
      refreshSelectedHost()
    ]);

    clearBanner();
  } catch (error) {
    const status = Number.isInteger(error.status) ? ` (${error.status})` : "";
    setBanner(`Unable to refresh operator data${status}: ${error.message}`, error.status === 401 ? "warning" : "danger");
  } finally {
    setBusy("");
    render();
  }
}

async function refreshSelectedJob() {
  if (!state.selectedJobId) {
    state.selectedJob = null;
    state.selectedJobLive = null;
    state.selectedJobResult = null;
    return;
  }

  try {
    const [jobPayload, livePayload, resultPayload] = await Promise.all([
      apiFetch(`/api/jobs/${encodeURIComponent(state.selectedJobId)}`),
      apiFetch(`/api/jobs/${encodeURIComponent(state.selectedJobId)}/live`),
      apiFetch(`/api/jobs/${encodeURIComponent(state.selectedJobId)}/result`).catch(() => null)
    ]);

    state.selectedJob = jobPayload?.job || null;
    state.selectedJobLive = livePayload || null;
    state.selectedJobResult = resultPayload?.result || null;
  } catch (error) {
    state.selectedJob = null;
    state.selectedJobLive = null;
    state.selectedJobResult = null;
    setBanner(`Unable to load job detail: ${error.message}`, "danger");
  }
}

async function refreshSelectedHost() {
  if (!state.selectedHostId) {
    state.selectedHost = null;
    state.selectedHostMetrics = null;
    return;
  }

  try {
    const [hostPayload, metricsPayload] = await Promise.all([
      apiFetch(`/api/hosts/${encodeURIComponent(state.selectedHostId)}`),
      apiFetch(`/api/hosts/${encodeURIComponent(state.selectedHostId)}/metrics`).catch(() => null)
    ]);

    state.selectedHost = hostPayload?.host || null;
    state.selectedHostMetrics = metricsPayload?.metrics?.metrics || metricsPayload?.metrics || null;
  } catch (error) {
    state.selectedHost = null;
    state.selectedHostMetrics = null;
    setBanner(`Unable to load host detail: ${error.message}`, "danger");
  }
}

function syncHostSelectors() {
  const hostOptions = state.hosts.map((host) => `<option value="${escapeHtml(host.hostId)}">${escapeHtml(host.displayName || host.hostId)}</option>`);
  const fullOptions = [`<option value="">All hosts</option>`, ...hostOptions].join("");
  elements.filterHostSelect.innerHTML = fullOptions;
  elements.filterHostSelect.value = state.filters.hostId;

  elements.createHostSelect.innerHTML = hostOptions.join("");
  if (!elements.createHostSelect.value && state.hosts[0]) {
    elements.createHostSelect.value = state.hosts.find((host) => host.heartbeat?.status === "online")?.hostId || state.hosts[0].hostId;
  }
}

function renderSummary() {
  const onlineHosts = state.hosts.filter((host) => host.heartbeat?.status === "online").length;
  const driftedHosts = Array.isArray(state.health?.workflow?.driftedHosts)
    ? state.health.workflow.driftedHosts.length
    : 0;
  const cards = [
    { label: "Tracked hosts", value: state.hosts.length },
    { label: "Online hosts", value: onlineHosts },
    { label: "Visible jobs", value: state.jobs.length },
    { label: "Pending approvals", value: state.approvals.length },
    { label: "Drifted hosts", value: driftedHosts }
  ];

  elements.summaryCards.innerHTML = cards.map((card) => `
    <article class="summary-card">
      <span class="label">${escapeHtml(card.label)}</span>
      <span class="value">${escapeHtml(card.value)}</span>
    </article>
  `).join("");
}

function renderJobs() {
  if (state.jobs.length === 0) {
    elements.jobsTable.innerHTML = `<div class="empty-state">No jobs matched the current filters.</div>`;
    return;
  }

  elements.jobsTable.innerHTML = state.jobs.map((job) => `
    <article class="table-row ${job.jobId === state.selectedJobId ? "selected" : ""}" data-job-id="${escapeHtml(job.jobId)}">
      <div>
        <div class="job-title">${escapeHtml(summarizeText(job.inputText))}</div>
        <div class="job-subtitle">${escapeHtml(job.jobId)} • ${escapeHtml(job.hostId || "unknown host")}</div>
      </div>
      <div><span class="${chipClassForState(job.state)}">${escapeHtml(job.state || "unknown")}</span></div>
      <div>${escapeHtml(job.delegationMode || "n/a")}</div>
      <div>${escapeHtml(formatDate(job.timestamps?.updatedAt))}</div>
    </article>
  `).join("");
}

function renderHosts() {
  if (state.hosts.length === 0) {
    elements.hostsList.innerHTML = `<div class="empty-state">No hosts have been registered yet.</div>`;
    return;
  }

  elements.hostsList.innerHTML = state.hosts.map((host) => {
    const drifted = state.health?.workflow?.driftedHosts?.some((entry) => entry.hostId === host.hostId) || false;
    return `
      <article class="host-card ${host.hostId === state.selectedHostId ? "selected" : ""}" data-host-id="${escapeHtml(host.hostId)}">
        <header>
          <div>
            <strong>${escapeHtml(host.displayName || host.hostId)}</strong>
            <div class="detail-copy">${escapeHtml(host.hostId)}</div>
          </div>
          <span class="${chipClassForState(host.heartbeat?.status)}">${escapeHtml(host.heartbeat?.status || "unknown")}</span>
        </header>
        <div class="chip-row">
          <span class="${chipClassForState(host.auth?.status)}">${escapeHtml(host.auth?.status || "pending")}</span>
          <span class="${chipClassForState(drifted ? "warn" : "healthy")}">${drifted ? "workflow drift" : "workflow aligned"}</span>
        </div>
        <p class="detail-copy">Last heartbeat: ${escapeHtml(formatDate(host.heartbeat?.lastSeenAt))}</p>
        <div class="inline-actions">
          <button type="button" class="ghost" data-refresh-host="${escapeHtml(host.hostId)}">Refresh workflow</button>
        </div>
      </article>
    `;
  }).join("");

  for (const card of elements.hostsList.querySelectorAll("[data-host-id]")) {
    card.addEventListener("click", async (event) => {
      if (event.target.closest("[data-refresh-host]")) {
        return;
      }
      state.selectedHostId = card.dataset.hostId;
      await refreshSelectedHost();
      render();
    });
  }

  for (const button of elements.hostsList.querySelectorAll("[data-refresh-host]")) {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const hostId = button.dataset.refreshHost;
      await runAction(`Refreshing workflow on ${hostId}...`, async () => {
        await apiFetch(`/api/hosts/${encodeURIComponent(hostId)}/workflow/refresh`, { method: "POST", body: {} });
        setBanner(`Workflow refreshed for ${hostId}.`, "info");
        await refreshDashboard({ forceDetail: hostId === state.selectedHostId });
      });
    });
  }
}

function renderApprovals() {
  if (state.approvals.length === 0) {
    elements.approvalsList.innerHTML = `<div class="empty-state">No pending approvals right now.</div>`;
    return;
  }

  elements.approvalsList.innerHTML = state.approvals.map((approval) => `
    <article class="approval-card">
      <header>
        <div>
          <strong>Request ${escapeHtml(approval.requestId)}</strong>
          <div class="detail-copy">${escapeHtml(approval.hostId)} • ${escapeHtml(approval.jobId || "no job")}</div>
        </div>
        <span class="chip warning">awaiting approval</span>
      </header>
      <div class="detail-copy">${escapeHtml(approval.message || approval.prompt || approval.reason || "Review the pending operation and choose an outcome.")}</div>
      <div class="inline-actions">
        <button type="button" data-approve="${escapeHtml(approval.requestId)}" data-host-id="${escapeHtml(approval.hostId)}">Approve</button>
        <button type="button" class="danger" data-reject="${escapeHtml(approval.requestId)}" data-host-id="${escapeHtml(approval.hostId)}">Reject</button>
      </div>
    </article>
  `).join("");

  for (const button of elements.approvalsList.querySelectorAll("[data-approve]")) {
    button.addEventListener("click", async () => {
      const requestId = button.dataset.approve;
      const hostId = button.dataset.hostId;
      await runAction(`Approving request ${requestId}...`, async () => {
        await apiFetch(`/api/approvals/${encodeURIComponent(requestId)}/approve`, {
          method: "POST",
          body: {
            hostId,
            result: { approved: true, notes: "Approved from Phase 11 operator console" }
          }
        });
        setBanner(`Approval ${requestId} accepted.`, "info");
        await refreshDashboard();
      });
    });
  }

  for (const button of elements.approvalsList.querySelectorAll("[data-reject]")) {
    button.addEventListener("click", async () => {
      const requestId = button.dataset.reject;
      const hostId = button.dataset.hostId;
      await runAction(`Rejecting request ${requestId}...`, async () => {
        await apiFetch(`/api/approvals/${encodeURIComponent(requestId)}/reject`, {
          method: "POST",
          body: {
            hostId,
            message: "Rejected from Phase 11 operator console"
          }
        });
        setBanner(`Approval ${requestId} rejected.`, "warning");
        await refreshDashboard();
      });
    });
  }
}

function renderJobDetail() {
  const job = state.selectedJob;
  if (!job) {
    elements.jobDetail.className = "detail-shell empty-state";
    elements.jobDetail.textContent = "Select a job to inspect live state, results, and replay controls.";
    return;
  }

  const live = state.selectedJobLive;
  const result = state.selectedJobResult;
  const approvals = Array.isArray(live?.pendingApprovals) ? live.pendingApprovals : [];
  const cloneTargetOptions = state.hosts
    .map((host) => `<option value="${escapeHtml(host.hostId)}" ${host.hostId === job.hostId ? "selected" : ""}>${escapeHtml(host.displayName || host.hostId)}</option>`)
    .join("");

  elements.jobDetail.className = "detail-shell";
  elements.jobDetail.innerHTML = `
    <article class="detail-card">
      <header>
        <div>
          <strong>${escapeHtml(summarizeText(job.inputText, 180))}</strong>
          <div class="detail-copy">${escapeHtml(job.jobId)} • ${escapeHtml(job.hostId || "unknown host")}</div>
        </div>
        <span class="${chipClassForState(job.state)}">${escapeHtml(job.state || "unknown")}</span>
      </header>
      <div class="detail-grid">
        <div class="detail-meta">
          <span>Delegation: ${escapeHtml(job.delegationMode || "n/a")}</span>
          <span>Created: ${escapeHtml(formatDate(job.timestamps?.createdAt))}</span>
          <span>Updated: ${escapeHtml(formatDate(job.timestamps?.updatedAt))}</span>
          <span>Thread: ${escapeHtml(job.threadId || "n/a")}</span>
        </div>
        <div class="detail-meta">
          <span>Pending approvals: ${escapeHtml(approvals.length)}</span>
          <span>Result summary: ${escapeHtml(result?.resultSummary || job.resultSummary || "n/a")}</span>
          <span>Artifacts: ${escapeHtml((result?.artifactPaths || job.artifactPaths || []).length)}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button type="button" data-job-action="start" ${job.state !== "queued" ? "disabled" : ""}>Start</button>
        <button type="button" class="danger" data-job-action="interrupt" ${["completed", "failed", "cancelled"].includes(job.state) ? "disabled" : ""}>Interrupt</button>
        <button type="button" data-job-action="retry" ${["completed", "failed", "cancelled"].includes(job.state) ? "" : "disabled"}>Retry</button>
        <button type="button" class="ghost" data-job-action="rerun">Rerun</button>
      </div>
    </article>
    <article class="detail-card">
      <header>
        <div>
          <strong>Replay</strong>
          <div class="detail-copy">Clone this run to a host while keeping the existing job as history.</div>
        </div>
      </header>
      <div class="inline-actions">
        <label class="field grow">
          <span>Clone target host</span>
          <select id="clone-host-select">${cloneTargetOptions}</select>
        </label>
        <button type="button" id="clone-job-button">Clone run</button>
      </div>
    </article>
    <article class="detail-card">
      <header>
        <div>
          <strong>Artifacts</strong>
          <div class="detail-copy">Result summary and artifact paths persisted for this run.</div>
        </div>
      </header>
      ${result?.resultSummary || job.resultSummary ? `<p>${escapeHtml(result?.resultSummary || job.resultSummary)}</p>` : `<p class="detail-copy">No summary captured yet.</p>`}
      ${(result?.artifactPaths || job.artifactPaths || []).length > 0
        ? `<ul class="artifact-list">${(result?.artifactPaths || job.artifactPaths || []).map((artifactPath) => `<li>${escapeHtml(artifactPath)}</li>`).join("")}</ul>`
        : `<p class="detail-copy">No artifact paths recorded yet.</p>`}
    </article>
  `;

  for (const button of elements.jobDetail.querySelectorAll("[data-job-action]")) {
    button.addEventListener("click", async () => {
      const action = button.dataset.jobAction;
      await runAction(`Running ${action} on ${job.jobId}...`, async () => {
        if (action === "rerun") {
          await apiFetch(`/api/jobs/${encodeURIComponent(job.jobId)}/rerun`, {
            method: "POST",
            body: { startNow: true }
          });
        } else if (action === "retry") {
          await apiFetch(`/api/jobs/${encodeURIComponent(job.jobId)}/retry`, {
            method: "POST",
            body: { startNow: false }
          });
        } else {
          await apiFetch(`/api/jobs/${encodeURIComponent(job.jobId)}/${action}`, {
            method: "POST",
            body: {}
          });
        }
        setBanner(`Job action ${action} completed for ${job.jobId}.`, "info");
        await refreshDashboard({ forceDetail: true });
      });
    });
  }

  const cloneButton = document.querySelector("#clone-job-button");
  if (cloneButton) {
    cloneButton.addEventListener("click", async () => {
      const cloneHostSelect = document.querySelector("#clone-host-select");
      const hostId = cloneHostSelect?.value || job.hostId;
      await runAction(`Cloning ${job.jobId} onto ${hostId}...`, async () => {
        const response = await apiFetch(`/api/jobs/${encodeURIComponent(job.jobId)}/clone`, {
          method: "POST",
          body: { hostId, startNow: false }
        });
        const clonedJobId = response?.clonedJobId || response?.job?.jobId || "new job";
        setBanner(`Cloned ${job.jobId} to ${clonedJobId}.`, "info");
        state.selectedJobId = clonedJobId;
        await refreshDashboard({ forceDetail: true });
      });
    });
  }
}

function renderHostDetail() {
  const host = state.selectedHost;
  if (!host) {
    elements.hostDetail.className = "detail-shell empty-state";
    elements.hostDetail.textContent = "Pick a host card to inspect metrics and workflow status.";
    return;
  }

  const metrics = state.selectedHostMetrics || {};
  elements.hostDetail.className = "detail-shell";
  elements.hostDetail.innerHTML = `
    <article class="detail-card">
      <header>
        <div>
          <strong>${escapeHtml(host.displayName || host.hostId)}</strong>
          <div class="detail-copy">${escapeHtml(host.hostId)}</div>
        </div>
        <span class="${chipClassForState(host.heartbeat?.status)}">${escapeHtml(host.heartbeat?.status || "unknown")}</span>
      </header>
      <div class="detail-grid">
        <div class="detail-meta">
          <span>Auth: ${escapeHtml(host.auth?.status || "pending")}</span>
          <span>Workflow status: ${escapeHtml(host.workflow?.status || "unknown")}</span>
          <span>Workflow hash: ${escapeHtml(host.workflow?.contentHash || "n/a")}</span>
        </div>
        <div class="detail-meta">
          <span>Requests: ${escapeHtml(metrics.requestsTotal ?? "n/a")}</span>
          <span>Workflow refresh attempts: ${escapeHtml(metrics.workflowRefresh?.attempts ?? "n/a")}</span>
          <span>Hook failures: ${escapeHtml(metrics.workflowHooks?.failures ?? "n/a")}</span>
        </div>
      </div>
    </article>
  `;
}

function render() {
  renderBanner();
  renderSummary();
  renderJobs();
  renderHosts();
  renderApprovals();
  renderJobDetail();
  renderHostDetail();
}

async function runAction(label, callback) {
  setBusy(label);
  try {
    await callback();
  } catch (error) {
    const tone = error.status === 401 ? "warning" : "danger";
    setBanner(error.message, tone);
  } finally {
    setBusy("");
  }
}

function clearPollingTimer() {
  if (state.timerId !== null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function startPolling() {
  clearPollingTimer();
  if (!state.autoRefresh) {
    return;
  }
  state.timerId = window.setInterval(() => {
    void refreshDashboard();
  }, pollIntervalMs);
}

function bindEvents() {
  elements.tokenInput.value = state.token;

  elements.jobsTable.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-job-id]");
    if (!row || !elements.jobsTable.contains(row)) {
      return;
    }

    state.selectedJobId = row.dataset.jobId || null;
    await refreshSelectedJob();
    render();
  });

  elements.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setToken(elements.tokenInput.value);
    await refreshDashboard();
  });

  elements.clearTokenButton.addEventListener("click", async () => {
    setToken("");
    await refreshDashboard();
  });

  elements.autoRefreshInput.checked = state.autoRefresh;
  elements.autoRefreshInput.addEventListener("change", () => {
    state.autoRefresh = elements.autoRefreshInput.checked;
    startPolling();
  });

  elements.refreshButton.addEventListener("click", async () => {
    await refreshDashboard({ forceDetail: true });
  });

  elements.detailRefreshButton.addEventListener("click", async () => {
    await runAction("Refreshing selected job...", async () => {
      await refreshSelectedJob();
      render();
    });
  });

  elements.createJobForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const hostId = elements.createHostSelect.value;
    const inputText = elements.createInputText.value.trim();
    if (!hostId || !inputText) {
      setBanner("Choose a host and describe the job before dispatching.", "warning");
      return;
    }

    await runAction(`Dispatching job to ${hostId}...`, async () => {
      const payload = await apiFetch("/api/jobs", {
        method: "POST",
        body: {
          hostId,
          inputText,
          autoStart: elements.createAutoStart.checked
        }
      });
      const createdJobId = payload?.job?.jobId || null;
      elements.createInputText.value = "";
      elements.createAutoStart.checked = false;
      if (createdJobId) {
        state.selectedJobId = createdJobId;
      }
      setBanner(`Dispatched ${createdJobId || "job"} to ${hostId}.`, "info");
      await refreshDashboard({ forceDetail: true });
    });
  });

  elements.jobsFilterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.filters.hostId = elements.filterHostSelect.value;
    state.filters.state = elements.filterStateSelect.value;
    state.filters.q = elements.filterQueryInput.value.trim();
    await refreshDashboard({ forceDetail: true });
  });

  window.addEventListener("beforeunload", () => {
    clearPollingTimer();
  });
}

bindEvents();
void refreshDashboard({ forceDetail: true });
startPolling();
