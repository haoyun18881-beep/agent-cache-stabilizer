import http from "node:http";
import { createConfigReloader, loadConfig } from "./config.js";
import { IdentityResolver } from "./identity.js";
import { createLogger } from "./logger.js";
import { ensureRuntimeDirs } from "./runtime.js";
import { StatePersister } from "./state-persister.js";
import { forwardToUpstream } from "./upstream.js";
import { WaterlineManager } from "./waterline.js";

const config = loadConfig();
const configReloader = createConfigReloader();
ensureRuntimeDirs(config);
const logger = createLogger(config);
const identityResolver = new IdentityResolver(config);
const statePersister = new StatePersister(config, logger);
const waterline = new WaterlineManager(config, logger, statePersister.load());

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    logger.error(`[ACS] error ${error?.stack || error}`);
    if (!res.headersSent) {
      sendJson(res, 500, { error: { message: "agent-cache-stabilizer internal error" } });
    } else {
      res.end();
    }
  }
});

server.listen(config.port, config.host, () => {
  logger.info(`[ACS] listening on http://${config.host}:${config.port}`);
});

async function route(req, res) {
  reloadConfigIfChanged();
  const path = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`).pathname;

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true, name: "agent-cache-stabilizer" });
    return;
  }

  if ((req.method === "POST" || req.method === "GET") && path === "/reset") {
    waterline.reset("manual reset");
    statePersister.clear();
    sendJson(res, 200, { ok: true, state: waterline.getStateSummary() });
    return;
  }

  if (req.method === "GET" && path === "/state") {
    sendJson(res, 200, { ok: true, state: waterline.getStateSummary() });
    return;
  }

  if (req.method === "POST" && path === "/v1/chat/completions") {
    const incoming = await readJson(req);
    const identity = identityResolver.resolve(req.headers, incoming);
    const built = waterline.build(incoming, identity);
    statePersister.save(waterline.exportState());
    await forwardToUpstream({
      req,
      res,
      body: built.body,
      identity,
      config,
      logger
    });
    return;
  }

  sendJson(res, 404, { error: { message: "not found" } });
}

function reloadConfigIfChanged() {
  if (!configReloader.reloadIfChanged(config)) return;
  ensureRuntimeDirs(config);
  logger.info(`[ACS] config reloaded from ${configReloader.path}`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}
