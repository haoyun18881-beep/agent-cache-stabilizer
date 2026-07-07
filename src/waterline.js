import { archiveMessage, tokenSum } from "./archive.js";
import { fingerprintMessage, fingerprintMessages } from "./fingerprint.js";
import {
  cloneForStore,
  cloneMessage,
  getMessageTokens,
  splitMessages,
  toOutboundMessage
} from "./message-utils.js";
import { estimateMessagesTokens, refreshTokenEstimate } from "./token-estimator.js";
import { repairToolChain } from "./tool-chain.js";
import { formatK } from "./logger.js";

export class WaterlineManager {
  constructor(config, logger, persistedState = null) {
    this.config = config;
    this.logger = logger;
    this.state = createEmptyState("anonymous-main");
    if (persistedState) this.importState(persistedState);
  }

  reset(reason = "manual reset") {
    const trimCount = this.state.trimCount;
    this.state = createEmptyState("anonymous-main");
    this.state.trimCount = trimCount;
    this.logger?.info(`[MAIN] NEW: ${reason}; cleared album`);
  }

  build(body, identity) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const { stable, body: incomingBody } = splitMessages(messages);

    if (identity.lane !== "MAIN") {
      this.logger?.info(
        `${identity.laneLabel} passthrough messages=${messages.length} model=${body?.model || ""}${formatIdentityMeta(identity)}`
      );
      return {
        body: { ...body, messages },
        stats: {
          laneLabel: identity.laneLabel,
          mode: "passthrough",
          inputMessages: messages.length,
          outputMessages: messages.length,
          added: 0,
          waterTotal: estimateMessagesTokens(messages)
        }
      };
    }

    const newSession = this.shouldResetForRequest(stable, incomingBody, identity);
    if (newSession) {
      this.state = createEmptyState(identity.sessionKey);
      this.state.sessionId = identity.sessionId;
      this.logger?.info("[MAIN] NEW: session changed; cleared album");
    }

    if (!this.state.stableSystem.length && stable.length > 0) {
      this.state.stableSystem = stable.map(cloneForStore);
      this.state.systemFingerprint = fingerprintMessages(stable);
    }

    this.state.sessionKey = identity.sessionKey;
    this.state.sessionId = identity.sessionId;
    this.state.lastRequestTime = Date.now();

    const beforeLength = this.state.internalBody.length;
    const tail = findNewTail(incomingBody, this.state.internalBody);
    for (const message of tail) {
      this.state.internalBody.push(cloneForStore(message));
    }

    const compaction =
      beforeLength > 0 &&
      incomingBody.length > 0 &&
      incomingBody.length < Math.max(4, beforeLength * 0.6) &&
      tail.length <= incomingBody.length;

    if (compaction) {
      this.logger?.info(
        `[MAIN] Agent compaction: body ${beforeLength} -> ${incomingBody.length}; keeping internal album`
      );
    }

    const beforeTrimTokens = this.currentWaterTokens();
    let trimStats = null;
    let mode = compaction ? "compaction" : tail.length > 0 ? "append" : "stable";

    if (beforeTrimTokens > this.config.waterline.trimTriggerTokens) {
      this.logger?.info(
        `[MAIN] TRIM trigger: total=${formatK(beforeTrimTokens)} > trigger=${formatK(this.config.waterline.trimTriggerTokens)}`
      );
      trimStats = this.trim();
      mode = "trim";
      this.logger?.info(
        `[MAIN] TRIM done: ${formatK(trimStats.beforeTokens)} -> ${formatK(trimStats.afterTokens)} | recentFull=${formatK(trimStats.recentTokens)} | archiveQa=${formatK(trimStats.archiveTokens)} | dropped=${formatK(trimStats.droppedTokens)}`
      );
    }

    const outputMessages = this.outboundMessages();
    const repairStats = repairToolChain(outputMessages);
    if (repairStats.addedPlaceholders || repairStats.addedAssistants) {
      this.logger?.info(
        `[MAIN] tool-chain repair: missingToolResults=${repairStats.addedPlaceholders} orphanTools=${repairStats.addedAssistants}`
      );
      if (this.config.logging?.logToolChainRepairDetails) {
        this.logger?.info(`[MAIN] tool-chain repair detail: ${formatRepairDetails(repairStats)}`);
      }
    }

    this.state.lastSeenAgentBodyLength = incomingBody.length;
    this.state.lastRequestFingerprint = fingerprintMessages(incomingBody);

    const waterTotal = this.currentWaterTokens();
    const archiveTokens = tokenSum(this.state.internalBody.filter((message) => message._ocs?.archived));
    const recentTokens = Math.max(0, waterTotal - archiveTokens);

    this.logger?.info(
      `[MAIN] Water total=${formatK(waterTotal)} recent=${formatK(recentTokens)} archive=${formatK(archiveTokens)} mode=${mode} added=${tail.length} out=${repairStats.messages.length}`
    );

    return {
      body: {
        ...body,
        messages: repairStats.messages.map(toOutboundMessage)
      },
      stats: {
        laneLabel: "[MAIN]",
        mode,
        inputMessages: messages.length,
        outputMessages: repairStats.messages.length,
        added: tail.length,
        waterTotal,
        trimStats,
        compaction,
        repairStats
      }
    };
  }

  getStateSummary() {
    const archiveTokens = tokenSum(this.state.internalBody.filter((message) => message._ocs?.archived));
    const total = this.currentWaterTokens();
    return {
      lane: "MAIN",
      sessionKey: this.state.sessionKey,
      sessionId: this.state.sessionId,
      messages: this.state.internalBody.length,
      stableSystemMessages: this.state.stableSystem.length,
      waterTotalTokens: total,
      archiveTokens,
      recentTokens: Math.max(0, total - archiveTokens),
      trimCount: this.state.trimCount,
      lastTrimAt: this.state.lastTrimAt,
      createdAt: this.state.createdAt,
      lastRequestTime: this.state.lastRequestTime
    };
  }

  exportState() {
    return cloneMessage(this.state);
  }

  importState(state) {
    if (!state || typeof state !== "object") return false;
    const next = {
      ...createEmptyState(state.sessionKey || "anonymous-main"),
      ...state,
      stableSystem: Array.isArray(state.stableSystem) ? state.stableSystem : [],
      internalBody: Array.isArray(state.internalBody) ? state.internalBody : []
    };

    for (const message of next.stableSystem) refreshTokenEstimate(message);
    for (const message of next.internalBody) refreshTokenEstimate(message);
    this.state = next;
    return true;
  }

  shouldResetForRequest(stable, incomingBody, identity) {
    if (!this.state.internalBody.length && !this.state.stableSystem.length) return false;
    if (identity.hasExplicitSession && identity.sessionKey !== this.state.sessionKey) return true;

    const incomingSystemFingerprint = fingerprintMessages(stable);
    const systemChanged =
      stable.length > 0 &&
      this.state.systemFingerprint &&
      incomingSystemFingerprint !== this.state.systemFingerprint;
    const bodyIsShort = incomingBody.length <= 4 && this.state.internalBody.length >= 12;
    const hasOverlap = findOverlap(incomingBody, this.state.internalBody).overlap > 0;
    const looksLikeFreshStart = isLikelyFreshShortConversation(incomingBody);

    return (
      !identity.hasExplicitSession &&
      bodyIsShort &&
      !hasOverlap &&
      (systemChanged || looksLikeFreshStart)
    );
  }

  trim() {
    const beforeTokens = this.currentWaterTokens();
    const body = this.state.internalBody;
    const waterline = this.config.waterline;

    let recentTokens = 0;
    let recentStart = body.length;
    while (recentStart > 0 && recentTokens < waterline.recentFullTokens) {
      recentStart -= 1;
      recentTokens += getMessageTokens(body[recentStart]);
    }

    const recentPart = body.slice(recentStart).map(cloneForStore);
    const toolNames = collectToolNames(body);
    const archivePart = [];
    let archiveTokens = 0;
    let archiveStart = recentStart;

    while (archiveStart > 0 && archiveTokens < waterline.archiveQaTokens) {
      archiveStart -= 1;
      const original = body[archiveStart];
      const archived = archiveMessage(original, {
        prefixChars: waterline.archivedToolPrefixChars,
        toolName: original.tool_call_id ? toolNames.get(original.tool_call_id) : ""
      });
      archivePart.unshift(archived);
      archiveTokens += getMessageTokens(archived);
    }

    const kept = archivePart.concat(recentPart);
    const afterBodyTokens = tokenSum(kept);
    const stableTokens = tokenSum(this.state.stableSystem);
    const afterTokens = stableTokens + afterBodyTokens;
    const droppedTokens = Math.max(0, beforeTokens - afterTokens);

    this.state.internalBody = kept;
    this.state.trimCount += 1;
    this.state.lastTrimAt = Date.now();

    return {
      beforeTokens,
      afterTokens,
      recentTokens: tokenSum(recentPart),
      archiveTokens: tokenSum(archivePart),
      droppedTokens
    };
  }

  currentWaterTokens() {
    return tokenSum(this.state.stableSystem) + tokenSum(this.state.internalBody);
  }

  outboundMessages() {
    return this.state.stableSystem.concat(this.state.internalBody).map(cloneMessage);
  }
}

function formatIdentityMeta(identity) {
  const parts = [];
  if (identity.taskId) parts.push(`task=${identity.taskId}`);
  if (identity.taskName) parts.push(`name=${identity.taskName}`);
  if (identity.groupName) parts.push(`group=${identity.groupName}`);
  if (identity.batchName) parts.push(`batch=${identity.batchName}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function createEmptyState(sessionKey) {
  const now = Date.now();
  return {
    sessionKey,
    sessionId: "",
    lane: "MAIN",
    stableSystem: [],
    internalBody: [],
    lastSeenAgentBodyLength: 0,
    lastRequestFingerprint: "",
    systemFingerprint: "",
    trimCount: 0,
    lastTrimAt: 0,
    createdAt: now,
    lastRequestTime: now
  };
}

export function findNewTail(incomingBody, internalBody) {
  if (!incomingBody.length) return [];
  if (!internalBody.length) return incomingBody;

  const overlap = findOverlap(incomingBody, internalBody);
  if (overlap.overlap > 0) {
    return incomingBody.slice(overlap.incomingStart + overlap.overlap);
  }

  const known = new Set(internalBody.map(fingerprintMessage));
  const unseen = incomingBody.filter((message) => !known.has(fingerprintMessage(message)));
  if (incomingBody.length < internalBody.length && unseen.length > 0) {
    return unseen.slice(-Math.min(unseen.length, 3));
  }
  return unseen;
}

export function findOverlap(incomingBody, internalBody) {
  const incoming = incomingBody.map(fingerprintMessage);
  const internal = internalBody.map(fingerprintMessage);
  let best = { overlap: 0, incomingStart: 0 };

  for (let incomingStart = 0; incomingStart < incoming.length; incomingStart += 1) {
    const maxOverlap = Math.min(internal.length, incoming.length - incomingStart);
    for (let size = maxOverlap; size >= 1; size -= 1) {
      const internalStart = internal.length - size;
      let equal = true;
      for (let offset = 0; offset < size; offset += 1) {
        if (internal[internalStart + offset] !== incoming[incomingStart + offset]) {
          equal = false;
          break;
        }
      }
      if (equal && size > best.overlap) {
        best = { overlap: size, incomingStart };
      }
    }
  }

  return best;
}

function collectToolNames(messages) {
  const names = new Map();
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (call?.id) names.set(call.id, call.function?.name || "tool");
    }
  }
  return names;
}

function isLikelyFreshShortConversation(incomingBody) {
  if (!incomingBody.length) return false;
  const nonToolMessages = incomingBody.filter((message) => message.role !== "tool");
  if (!nonToolMessages.length) return false;
  const assistantCount = nonToolMessages.filter((message) => message.role === "assistant").length;
  const userCount = nonToolMessages.filter((message) => message.role === "user").length;
  if (assistantCount > 0) return false;
  return userCount > 0;
}

function formatRepairDetails(repairStats) {
  const missing = repairStats.details?.missingToolResults || [];
  const orphan = repairStats.details?.orphanTools || [];
  const parts = [];

  for (let index = 0; index < missing.length; index += 1) {
    const item = missing[index];
    parts.push(
      `missing#${index} after=${item.after} before=${item.before} id=${item.id} name=${item.name}`
    );
  }

  for (let index = 0; index < orphan.length; index += 1) {
    const item = orphan[index];
    parts.push(`orphan#${index} at=${item.at} id=${item.id}`);
  }

  return parts.join(" | ");
}
