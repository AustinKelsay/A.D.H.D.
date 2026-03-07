import { RuntimeError } from "../runtime/errors.js";

export const DELEGATION_MODES = Object.freeze({
  MULTI_AGENT: "multi_agent",
  FALLBACK_WORKERS: "fallback_workers"
});

const MODE_SET = new Set(Object.values(DELEGATION_MODES));

function toMode(value) {
  if (typeof value !== "string") {
    return null;
  }
  const mode = value.trim().toLowerCase();
  return MODE_SET.has(mode) ? mode : null;
}

function toBoolean(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "on", "yes"].includes(normalized)) {
      return true;
    }
  }
  return Boolean(value);
}

function normalizePolicy(policy = {}) {
  const defaultMode = toMode(policy.defaultMode) || DELEGATION_MODES.FALLBACK_WORKERS;
  return {
    defaultMode,
    allowMultiAgent: toBoolean(policy.allowMultiAgent, true),
    multiAgentKillSwitch: toBoolean(policy.multiAgentKillSwitch, false)
  };
}

function hostSupportsMultiAgent(hostCapabilities = null) {
  if (!hostCapabilities || typeof hostCapabilities !== "object") {
    return false;
  }

  return toBoolean(hostCapabilities.multi_agent, false) || toBoolean(hostCapabilities.multiAgent, false);
}

export function resolveDelegationMode({
  requestedMode = null,
  profileHint = null,
  delegationPolicy = {},
  hostCapabilities = null
} = {}) {
  const policy = normalizePolicy(delegationPolicy);

  const requested = toMode(requestedMode) || toMode(profileHint) || policy.defaultMode;
  if (!requested) {
    throw new RuntimeError("INVALID_INPUT", "Unable to resolve delegation mode");
  }

  const supportsMultiAgent = hostSupportsMultiAgent(hostCapabilities);

  if (requested === DELEGATION_MODES.MULTI_AGENT) {
    if (policy.multiAgentKillSwitch) {
      return {
        requestedMode: requested,
        selectedMode: DELEGATION_MODES.FALLBACK_WORKERS,
        reasonCode: "kill-switch",
        reason: "multi_agent is disabled by policy kill switch",
        killSwitchApplied: true,
        policy,
        hostCapability: { multiAgent: supportsMultiAgent }
      };
    }

    if (!policy.allowMultiAgent) {
      return {
        requestedMode: requested,
        selectedMode: DELEGATION_MODES.FALLBACK_WORKERS,
        reasonCode: "policy-disabled",
        reason: "multi_agent is disabled in delegation policy",
        killSwitchApplied: false,
        policy,
        hostCapability: { multiAgent: supportsMultiAgent }
      };
    }

    if (!supportsMultiAgent) {
      return {
        requestedMode: requested,
        selectedMode: DELEGATION_MODES.FALLBACK_WORKERS,
        reasonCode: "capability-missing",
        reason: "host does not advertise multi_agent capability",
        killSwitchApplied: false,
        policy,
        hostCapability: { multiAgent: supportsMultiAgent }
      };
    }
  }

  return {
    requestedMode: requested,
    selectedMode: requested,
    reasonCode: "accepted",
    reason: "requested delegation mode accepted",
    killSwitchApplied: false,
    policy,
    hostCapability: { multiAgent: supportsMultiAgent }
  };
}
