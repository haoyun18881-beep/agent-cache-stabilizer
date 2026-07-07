import fs from "node:fs";

export class OpenClawSessionStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.lastMtimeMs = 0;
    this.sessionIdToKey = new Map();
  }

  lookupSessionKey(sessionId) {
    if (!sessionId || !this.filePath) return "";
    this.refreshIfNeeded();
    return this.sessionIdToKey.get(sessionId) || "";
  }

  refreshIfNeeded() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const stat = fs.statSync(this.filePath);
    if (stat.mtimeMs === this.lastMtimeMs) return;

    const raw = fs.readFileSync(this.filePath, "utf8");
    const data = JSON.parse(raw);
    const nextMap = new Map();
    collectSessionPairs(data, nextMap);
    this.sessionIdToKey = nextMap;
    this.lastMtimeMs = stat.mtimeMs;
  }
}

function collectSessionPairs(value, map, fallbackKey = "") {
  if (!value || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== "object") continue;

    const sessionKey =
      typeof item.sessionKey === "string"
        ? item.sessionKey
        : key.startsWith("agent:")
          ? key
          : fallbackKey;

    if (typeof item.sessionId === "string" && sessionKey) {
      map.set(item.sessionId, sessionKey);
    }

    collectSessionPairs(item, map, sessionKey);
  }
}
