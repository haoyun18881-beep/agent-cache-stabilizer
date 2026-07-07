import {
  cleanSnippet,
  cloneForStore,
  cloneMessage,
  getMessageTokens,
  hasToolCalls,
  isPlainQa
} from "./message-utils.js";
import { refreshTokenEstimate } from "./token-estimator.js";

export function archiveMessage(message, options = {}) {
  if (message?._ocs?.archived && message._ocs.archiveShape) {
    return cloneForStore(message._ocs.archiveShape);
  }

  const prefixChars = options.prefixChars ?? 20;
  let archived;

  if (isPlainQa(message)) {
    archived = cloneMessage(message);
  } else if (message?.role === "assistant" && hasToolCalls(message)) {
    archived = archiveAssistantToolCall(message, prefixChars);
  } else if (message?.role === "tool") {
    archived = archiveToolMessage(message, options.toolName || "tool", prefixChars);
  } else {
    archived = archiveNoiseMessage(message, prefixChars);
  }

  archived._ocs = {
    archived: true,
    archiveShape: null,
    estimatedTokens: 0,
    insertedAt: message?._ocs?.insertedAt || Date.now()
  };
  refreshTokenEstimate(archived);
  archived._ocs.archiveShape = cloneMessage(archived);
  archived._ocs.archiveShape._ocs = null;
  return archived;
}

export function isArchiveCandidate(message) {
  return Boolean(message);
}

export function tokenSum(messages) {
  return messages.reduce((sum, message) => sum + getMessageTokens(message), 0);
}

function archiveAssistantToolCall(message, prefixChars) {
  const archived = cloneMessage(message);
  archived.tool_calls = (message.tool_calls || []).map((call) => ({
    id: call.id,
    type: call.type || "function",
    function: {
      name: call.function?.name || "tool",
      arguments: cleanSnippet(call.function?.arguments || "", prefixChars)
    }
  }));
  if (archived.content && typeof archived.content !== "string") {
    archived.content = cleanSnippet(archived.content, prefixChars);
  }
  return archived;
}

function archiveToolMessage(message, toolName, prefixChars) {
  return {
    role: "tool",
    tool_call_id: message.tool_call_id,
    content: `[tool archived: ${toolName} ${cleanSnippet(message.content, prefixChars)}]`
  };
}

function archiveNoiseMessage(message, prefixChars) {
  const role = message?.role || "message";
  return {
    role: role === "assistant" ? "assistant" : "user",
    content: `[${role} archived: ${cleanSnippet(message?.content ?? message, prefixChars)}]`
  };
}
