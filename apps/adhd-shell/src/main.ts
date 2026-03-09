import { createDefaultEndpoints } from "./app-config";
import { readHealth, type HealthSnapshot } from "./health-client";
import "./styles.css";

function formatJson(value: Record<string, unknown> | null): string {
  return value ? JSON.stringify(value, null, 2) : "{}";
}

function renderCard(snapshot: HealthSnapshot): string {
  const stateClass = snapshot.ok ? "ready" : "blocked";
  const statusLabel = snapshot.status === null ? "offline" : String(snapshot.status);
  return `
    <article class="status-card ${stateClass}">
      <header>
        <p class="eyebrow">${snapshot.endpoint.label}</p>
        <h2>${snapshot.ok ? "Connected" : "Unavailable"}</h2>
      </header>
      <dl>
        <div>
          <dt>Base URL</dt>
          <dd>${snapshot.endpoint.baseUrl}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>${statusLabel}</dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>${new Date(snapshot.checkedAt).toLocaleTimeString()}</dd>
        </div>
      </dl>
      <p class="summary">${snapshot.summary}</p>
      <pre>${formatJson(snapshot.details)}</pre>
    </article>
  `;
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app root element.");
  }

  app.innerHTML = `
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">Phase 11</p>
        <h1>ADHD Tauri Shell</h1>
        <p class="lede">
          Desktop-first app shell for ADHD. This phase proves the client boundary
          against the existing host and federation APIs before dictation or mobile parity.
        </p>
        <button id="refresh-health" class="refresh-button" type="button">Refresh Health</button>
      </section>
      <section class="status-grid" id="status-grid">
        <article class="status-card loading">
          <header>
            <p class="eyebrow">Loading</p>
            <h2>Checking backend readiness</h2>
          </header>
        </article>
      </section>
      <section class="notes">
        <h2>Next shell milestones</h2>
        <ul>
          <li>Shared host and federation API client</li>
          <li>Desktop intake and job views</li>
          <li>Mobile shell and pairing/session UX</li>
          <li>Dictation capture and ASR integration</li>
        </ul>
      </section>
    </main>
  `;

  const grid = document.querySelector<HTMLElement>("#status-grid");
  const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-health");
  const endpoints = createDefaultEndpoints();

  const refresh = async () => {
    if (!grid || !refreshButton) {
      return;
    }
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    const snapshots = await Promise.all(endpoints.map((endpoint) => readHealth(endpoint)));
    grid.innerHTML = snapshots.map((snapshot) => renderCard(snapshot)).join("");
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh Health";
  };

  refreshButton?.addEventListener("click", () => {
    void refresh();
  });

  await refresh();
}

void bootstrap();
