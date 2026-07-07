import { OpenClawSessionStore } from "./session-store.js";

export class IdentityResolver {
  constructor(config) {
    this.config = config;
    this.sessionStore = new OpenClawSessionStore(config.identity?.openclawSessionStore);
  }

  resolve(headers, body) {
    const normalized = normalizeHeaders(headers);
    const acsLane = firstHeader(normalized, ["x-acs-lane"]).toUpperCase();
    const acsTaskId = firstHeader(normalized, ["x-acs-task-id"]);
    const acsTaskName = firstHeader(normalized, ["x-acs-task-name"]);
    const acsBatchName = firstHeader(normalized, ["x-acs-batch-name"]);
    const acsGroupName = firstHeader(normalized, ["x-acs-group-name"]);
    const explicitSessionKey = firstHeader(normalized, [
      "x-openclaw-session-key",
      "x-session-key"
    ]);
    const sessionId = firstHeader(normalized, [
      "x-openclaw-session-id",
      "session_id",
      "x-session-id",
      "x-session-affinity"
    ]);
    const taskId = acsTaskId || firstHeader(normalized, ["x-task-id"]);
    const mappedSessionKey = this.sessionStore.lookupSessionKey(sessionId);
    const userKey = typeof body?.user === "string" && body.user ? `user:${body.user}` : "";
    const fallbackHeader = firstHeader(normalized, this.config.identity?.preferHeaders || []);

    const sessionKey =
      explicitSessionKey ||
      mappedSessionKey ||
      sessionId ||
      userKey ||
      normalizeFallbackHeader(fallbackHeader) ||
      "anonymous-main";

    const subPattern = this.config.identity?.subAgentSessionPattern || "subagent:";
    const explicitSubLane = acsLane === "SUB" || acsLane === "TASK";
    const explicitMainLane = acsLane === "MAIN";
    const isSubAgent =
      explicitSubLane ||
      (!explicitMainLane &&
        (sessionKey.includes(subPattern) ||
          explicitSessionKey.includes(subPattern) ||
          mappedSessionKey.includes(subPattern) ||
          (taskId && taskId !== "main")));
    const lane = isSubAgent ? (acsLane === "TASK" ? "TASK" : "SUB") : "MAIN";
    const labelSeed =
      acsTaskName ||
      acsGroupName ||
      acsBatchName ||
      sessionKey ||
      taskId;

    return {
      lane,
      laneLabel: lane === "MAIN" ? "[MAIN]" : `[${lane}:${shortId(labelSeed)}]`,
      sessionKey,
      sessionId,
      taskId,
      taskName: acsTaskName,
      batchName: acsBatchName,
      groupName: acsGroupName,
      hasExplicitSession: Boolean(explicitSessionKey || mappedSessionKey || sessionId || userKey),
      stripHeaderNames: [
        "x-openclaw-session-key",
        "x-openclaw-session-id",
        "x-session-id",
        "session_id",
        "x-session-affinity",
        "x-client-request-id",
        "x-task-id",
        "x-acs-lane",
        "x-acs-task-id",
        "x-acs-task-name",
        "x-acs-batch-name",
        "x-acs-group-name"
      ]
    };
  }
}

export function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}

function firstHeader(headers, names = []) {
  for (const name of names) {
    const value = headers[String(name).toLowerCase()];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeFallbackHeader(value) {
  if (!value) return "";
  if (value.length > 80) return "";
  return value;
}

function shortId(value) {
  if (!value) return "unknown";
  const clean = String(value);
  if (clean.length <= 12) return clean;
  return clean.slice(-12);
}
