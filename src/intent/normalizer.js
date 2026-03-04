import { RuntimeError } from "../runtime/errors.js";

const WORKTYPE_RULES = [
  { pattern: /\b(refactor|cleanup|clean up|rewrite)\b/i, workType: "refactor", profileHint: "fallback_workers" },
  { pattern: /\b(test|unit test|integration test|e2e|verify)\b/i, workType: "test", profileHint: "fallback_workers" },
  { pattern: /\b(fix|bug|debug|repair)\b/i, workType: "bugfix", profileHint: "fallback_workers" },
  { pattern: /\b(pr|pull request|merge|release|deploy|tag)\b/i, workType: "git-release", profileHint: "multi_agent" },
  { pattern: /\b(document|docs|readme|changelog)\b/i, workType: "docs", profileHint: "fallback_workers" }
];

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function extractPaths(text) {
  const matches = text.match(/(?:\.|\/)\S+/g) || [];
  return [...new Set(matches.map((m) => m.replace(/[.,;:!?]+$/, "")))];
}

function extractConstraints(text) {
  const constraints = [];

  if (/\b(do not|don't|without)\b/i.test(text)) {
    constraints.push("respect-negative-instructions");
  }
  if (/\b(no tests|skip tests)\b/i.test(text)) {
    constraints.push("tests-optional");
  }
  if (/\b(high priority|urgent|urgently|asap)\b/i.test(text)) {
    constraints.push("high-priority");
  }

  return constraints.sort();
}

function classifyWorkType(text) {
  for (const rule of WORKTYPE_RULES) {
    if (rule.pattern.test(text)) {
      return {
        workType: rule.workType,
        profileHint: rule.profileHint
      };
    }
  }

  return {
    workType: "general-coding",
    profileHint: "fallback_workers"
  };
}

export function normalizeIntent({
  inputText,
  target = ".",
  hostConstraints = null,
  metadata = null
} = {}) {
  if (!inputText || typeof inputText !== "string") {
    throw new RuntimeError("INVALID_INPUT", "inputText is required and must be a string");
  }

  const rawText = inputText.trim();
  if (!rawText) {
    throw new RuntimeError("INVALID_INPUT", "inputText must not be empty");
  }

  const normalizedText = normalizeWhitespace(inputText).toLowerCase();
  const { workType, profileHint } = classifyWorkType(normalizedText);
  const paths = extractPaths(rawText);
  const constraints = extractConstraints(normalizedText);
  const normalizedTarget = typeof target === "string" && target.trim() ? target.trim() : ".";

  return {
    contractVersion: "intent.v1",
    rawText,
    normalizedText,
    workType,
    profileHint,
    target: normalizedTarget,
    paths,
    constraints,
    hostConstraints: hostConstraints || null,
    metadata: metadata || null
  };
}
