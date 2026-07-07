import { refreshTokenEstimate, stripInternalFields } from "./token-estimator.js";

export function cloneMessage(message) {
  return JSON.parse(JSON.stringify(message));
}

export function cloneForStore(message) {
  const cloned = cloneMessage(message);
  cloned._ocs = {
    archived: Boolean(cloned._ocs?.archived),
    archiveShape: cloned._ocs?.archiveShape || null,
    estimatedTokens: 0,
    insertedAt: cloned._ocs?.insertedAt || Date.now()
  };
  refreshTokenEstimate(cloned);
  return cloned;
}

export function toOutboundMessage(message) {
  return stripInternalFields(message);
}

export function splitMessages(messages = []) {
  const stable = [];
  const body = [];
  for (const message of messages) {
    if (message?.role === "system" || message?.role === "developer") stable.push(message);
    else body.push(message);
  }
  return { stable, body };
}

export function hasToolCalls(message) {
  return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
}

export function isPlainQa(message) {
  if (!message) return false;
  if (message.role === "user") return true;
  return message.role === "assistant" && !hasToolCalls(message);
}

export function getMessageTokens(message) {
  return message?._ocs?.estimatedTokens || refreshTokenEstimate(message);
}

export function cleanSnippet(value, limit = 20) {
  const text = stringifyContent(value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

export function stringifyContent(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
