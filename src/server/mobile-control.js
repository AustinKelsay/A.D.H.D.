import { randomBytes } from "node:crypto";

const DEFAULT_MAX_PENDING_PAIRINGS = 100;

function nowIso() {
  return new Date().toISOString();
}

function asPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function asBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return Boolean(value);
}

function parseBearerToken(authHeader = "") {
  if (typeof authHeader !== "string") {
    return null;
  }

  const trimmed = authHeader.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

function generatePairingCode() {
  return randomBytes(4).toString("base64url").slice(0, 6).toUpperCase();
}

function generateSessionToken() {
  return `ms_${randomBytes(18).toString("hex")}`;
}

export class MobileControlManager {
  constructor({
    pairingTtlMs = 5 * 60 * 1000,
    sessionTtlMs = 30 * 24 * 60 * 60 * 1000,
    eventsMax = 1000,
    streamHeartbeatMs = 15000,
    maxPendingPairings = DEFAULT_MAX_PENDING_PAIRINGS,
    enabled = true
  } = {}) {
    this.enabled = asBoolean(enabled, true);
    this.pairingTtlMs = asPositiveInt(pairingTtlMs, 5 * 60 * 1000);
    this.sessionTtlMs = asPositiveInt(sessionTtlMs, 30 * 24 * 60 * 60 * 1000);
    this.eventsMax = asPositiveInt(eventsMax, 1000);
    this.streamHeartbeatMs = asPositiveInt(streamHeartbeatMs, 15000);
    this.maxPendingPairings = asPositiveInt(maxPendingPairings, DEFAULT_MAX_PENDING_PAIRINGS);

    this.pairings = new Map();
    this.sessions = new Map();
    this.events = [];
    this.nextEventId = 1;
    this.streamClients = new Set();
  }

  startPairing({ deviceLabel = null, initiatedBy = "desktop" } = {}) {
    this.sweepExpiredEntries(Date.now());
    this.enforcePairingCapacity();

    let pairingCode = generatePairingCode();
    while (this.pairings.has(pairingCode)) {
      pairingCode = generatePairingCode();
    }
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + this.pairingTtlMs).toISOString();

    this.pairings.set(pairingCode, {
      pairingCode,
      deviceLabel,
      initiatedBy,
      createdAt,
      expiresAt
    });

    this.appendEvent({
      type: "mobile.pairing.started",
      payload: {
        pairingCode,
        deviceLabel,
        initiatedBy,
        expiresAt
      }
    });

    return {
      pairingCode,
      expiresAt
    };
  }

  completePairing(pairingCode, { deviceLabel = null, userAgent = null } = {}) {
    this.sweepExpiredEntries(Date.now());

    const key = typeof pairingCode === "string" ? pairingCode.trim().toUpperCase() : "";
    if (!key || !this.pairings.has(key)) {
      return null;
    }

    const pairing = this.pairings.get(key);
    if (Date.parse(pairing.expiresAt) <= Date.now()) {
      this.pairings.delete(key);
      return null;
    }

    this.pairings.delete(key);

    const token = generateSessionToken();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + this.sessionTtlMs).toISOString();
    const session = {
      deviceLabel: deviceLabel || pairing.deviceLabel || null,
      userAgent: typeof userAgent === "string" ? userAgent : null,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt
    };

    this.sessions.set(token, session);

    this.appendEvent({
      type: "mobile.session.created",
      payload: {
        deviceLabel: session.deviceLabel,
        createdAt,
        expiresAt
      }
    });

    return {
      token,
      session: structuredClone(session)
    };
  }

  sweepExpiredEntries(nowMs = Date.now()) {
    for (const [key, pairing] of this.pairings.entries()) {
      const expiresAtMs = Date.parse(pairing.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        this.pairings.delete(key);
      }
    }

    for (const [token, session] of this.sessions.entries()) {
      const expiresAtMs = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        this.sessions.delete(token);
      }
    }
  }

  pruneExpiredPairings(nowMs = Date.now()) {
    for (const [key, pairing] of this.pairings.entries()) {
      const expiresAtMs = Date.parse(pairing.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        this.pairings.delete(key);
      }
    }
  }

  enforcePairingCapacity() {
    while (this.pairings.size >= this.maxPendingPairings) {
      let oldestKey = null;
      let oldestCreatedAt = Number.POSITIVE_INFINITY;

      for (const [key, pairing] of this.pairings.entries()) {
        const createdAtMs = Date.parse(pairing.createdAt);
        if (createdAtMs < oldestCreatedAt) {
          oldestCreatedAt = createdAtMs;
          oldestKey = key;
        }
      }

      if (!oldestKey) {
        break;
      }
      this.pairings.delete(oldestKey);
    }
  }

  readTokenFromRequest(req) {
    return parseBearerToken(req?.headers?.authorization || "");
  }

  getSession(token, { touch = true } = {}) {
    this.sweepExpiredEntries(Date.now());

    if (!token || typeof token !== "string") {
      return null;
    }

    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    if (touch) {
      session.lastSeenAt = nowIso();
    }

    return structuredClone(session);
  }

  revokeSession(token) {
    if (!token || typeof token !== "string") {
      return false;
    }

    const existed = this.sessions.delete(token);
    if (existed) {
      this.appendEvent({
        type: "mobile.session.revoked",
        payload: {
          at: nowIso()
        }
      });
    }
    return existed;
  }

  appendEvent({ type, payload = null, jobId = null } = {}) {
    const event = {
      id: this.nextEventId++,
      at: nowIso(),
      type: typeof type === "string" && type ? type : "mobile.unknown",
      jobId: typeof jobId === "string" && jobId ? jobId : null,
      payload: payload && typeof payload === "object" ? structuredClone(payload) : payload
    };

    this.events.push(event);
    if (this.events.length > this.eventsMax) {
      this.events.splice(0, this.events.length - this.eventsMax);
    }

    this.publishToStreams(event);
    return structuredClone(event);
  }

  listEvents({ afterId = 0, limit = 100, jobId = null } = {}) {
    const safeAfter = Math.max(0, Number.parseInt(afterId, 10) || 0);
    const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));

    const filtered = this.events.filter((event) => {
      if (event.id <= safeAfter) {
        return false;
      }
      if (jobId && event.jobId !== jobId) {
        return false;
      }
      return true;
    });

    const items = filtered.slice(0, safeLimit).map((entry) => structuredClone(entry));
    return {
      events: items,
      nextAfterId: items.length > 0 ? items[items.length - 1].id : safeAfter,
      count: items.length,
      hasMore: filtered.length > items.length
    };
  }

  openEventStream({ req, res, afterId = 0, jobId = null } = {}) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");

    const sendEvent = (event) => {
      res.write(`id: ${event.id}\n`);
      res.write("event: mobile-event\n");
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const initial = this.listEvents({ afterId, limit: 500, jobId });
    for (const event of initial.events) {
      sendEvent(event);
    }

    const client = {
      res,
      jobId,
      sendEvent,
      heartbeat: setInterval(() => {
        try {
          res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          // ignore write failures; close handler removes client
        }
      }, this.streamHeartbeatMs)
    };

    this.streamClients.add(client);

    const close = () => {
      clearInterval(client.heartbeat);
      this.streamClients.delete(client);
      try {
        res.end();
      } catch {
        // noop
      }
    };

    req.on("close", close);
    req.on("error", close);
    res.on("close", close);
  }

  publishToStreams(event) {
    for (const client of this.streamClients) {
      if (client.jobId && client.jobId !== event.jobId) {
        continue;
      }

      try {
        client.sendEvent(event);
      } catch {
        clearInterval(client.heartbeat);
        this.streamClients.delete(client);
      }
    }
  }
}
