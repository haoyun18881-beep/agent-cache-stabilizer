import { createHash } from "node:crypto";

export function hashText(text, length = 12) {
  return createHash("sha256").update(text || "").digest("hex").slice(0, length);
}

export function fingerprintMessage(message) {
  return hashText(JSON.stringify(normalizeMessage(message)));
}

export function fingerprintMessages(messages) {
  return hashText(JSON.stringify(messages.map(normalizeMessage)), 16);
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") return message;
  const clean = {};
  for (const [key, value] of Object.entries(message)) {
    if (!key.startsWith("_")) clean[key] = value;
  }
  return clean;
}
