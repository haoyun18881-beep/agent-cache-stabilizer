import { TextDecoder } from "node:util";
import { resolveUpstreamForBody } from "./upstream-router.js";

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export async function forwardToUpstream({ req, res, body, identity, config, logger }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs || 180000);

  try {
    const route = resolveUpstreamForBody(body, config);
    const upstreamUrl = buildUpstreamUrl(route.upstream.baseUrl);
    const upstreamBody = route.targetModel && route.targetModel !== body.model
      ? { ...body, model: route.targetModel }
      : body;
    if (config.logging?.logUpstreamRoute) {
      logger.info(formatRouteLog(identity, body, route));
    }
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: buildForwardHeaders(req.headers, identity, route.upstream),
      body: JSON.stringify(upstreamBody),
      signal: controller.signal
    });

    writeResponseHeaders(res, upstreamRes);

    const contentType = upstreamRes.headers.get("content-type") || "";
    if (body.stream || contentType.includes("text/event-stream")) {
      await pipeStreamingResponse(upstreamRes, res, identity, logger);
      return;
    }

    const payload = Buffer.from(await upstreamRes.arrayBuffer());
    res.end(payload);

    if (upstreamRes.status >= 400) {
      logger.warn(
        `${identity.laneLabel} upstream ${upstreamRes.status}: ${payload.toString("utf8").slice(0, 500)}`
      );
    }

    const usage = parseUsageFromJson(payload);
    if (usage) logger.token(identity.laneLabel, usage);
  } finally {
    clearTimeout(timeout);
  }
}

export function buildUpstreamUrl(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function buildForwardHeaders(incomingHeaders, identity, upstream = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(incomingHeaders || {})) {
    const lower = key.toLowerCase();
    if (hopByHopHeaders.has(lower)) continue;
    if (identity.stripHeaderNames.includes(lower)) continue;
    if (lower === "authorization") continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  headers["content-type"] = "application/json";
  const incomingAuth = incomingHeaders.authorization || incomingHeaders.Authorization;
  const apiKey = upstream?.apiKey;
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  else if (incomingAuth) headers.authorization = incomingAuth;

  if (upstream?.headers && typeof upstream.headers === "object" && !Array.isArray(upstream.headers)) {
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value !== undefined && value !== null) headers[key] = String(value);
    }
  }

  return headers;
}

function formatRouteLog(identity, body, route) {
  const provider = route.providerName || "default";
  const target = route.targetModel || body?.model || "";
  return `${identity.laneLabel} Route model=${body?.model || ""} provider=${provider} type=${route.routeType} target=${target}`;
}

function writeResponseHeaders(res, upstreamRes) {
  res.statusCode = upstreamRes.status;
  upstreamRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!hopByHopHeaders.has(lower)) res.setHeader(key, value);
  });
}

async function pipeStreamingResponse(upstreamRes, res, identity, logger) {
  const decoder = new TextDecoder();
  let usage = null;
  let carry = "";

  for await (const chunk of upstreamRes.body) {
    const buffer = Buffer.from(chunk);
    res.write(buffer);
    const text = decoder.decode(buffer, { stream: true });
    const parsed = parseUsageFromSseChunk(carry + text, false);
    carry = parsed.carry;
    const found = parsed.usage;
    if (found) usage = found;
  }

  const tail = decoder.decode();
  if (tail || carry) {
    res.write(tail);
    const parsed = parseUsageFromSseChunk(carry + tail, true);
    const found = parsed.usage;
    if (found) usage = found;
  }

  res.end();
  if (usage) logger.token(identity.laneLabel, usage);
}

function parseUsageFromJson(buffer) {
  try {
    const data = JSON.parse(buffer.toString("utf8"));
    return data?.usage || null;
  } catch {
    return null;
  }
}

function parseUsageFromSseChunk(text, flush = false) {
  let usage = null;
  const lines = text.split(/\r?\n/);
  const carry = flush ? "" : lines.pop() || "";

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed?.usage) usage = parsed.usage;
    } catch {
      // Ignore malformed SSE events while continuing to forward the stream.
    }
  }
  return { usage, carry };
}
