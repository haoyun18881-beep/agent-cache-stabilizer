export function estimateTokens(value) {
  const text = stringifyForTokens(value);
  if (!text) return 0;

  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }

  return Math.max(1, Math.ceil(ascii / 4 + nonAscii * 0.75));
}

export function estimateMessageTokens(message) {
  return estimateTokens(stripInternalFields(message)) + 4;
}

export function estimateMessagesTokens(messages) {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export function refreshTokenEstimate(message) {
  message._ocs = {
    ...(message._ocs || {}),
    estimatedTokens: estimateMessageTokens(message)
  };
  return message._ocs.estimatedTokens;
}

export function stringifyForTokens(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function stripInternalFields(message) {
  if (!message || typeof message !== "object") return message;
  const clean = {};
  for (const [key, value] of Object.entries(message)) {
    if (!key.startsWith("_")) clean[key] = value;
  }
  return clean;
}
