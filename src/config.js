import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig } from "./defaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export function getProjectRoot() {
  return projectRoot;
}

export function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function loadConfig(
  configPath = process.env.ACS_CONFIG || process.env.AGENT_CACHE_STABILIZER_CONFIG
) {
  const resolvedPath = getConfigPath(configPath);
  let fileConfig = {};

  if (fs.existsSync(resolvedPath)) {
    fileConfig = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  }

  const config = deepMerge(defaultConfig, fileConfig);
  applyEnvOverrides(config);
  resolveRuntimePaths(config);
  resolveUpstreamSecrets(config);

  return config;
}

export function getConfigPath(
  configPath = process.env.ACS_CONFIG || process.env.AGENT_CACHE_STABILIZER_CONFIG
) {
  return configPath || path.join(projectRoot, "config.json");
}

export function createConfigReloader(
  configPath = process.env.ACS_CONFIG || process.env.AGENT_CACHE_STABILIZER_CONFIG
) {
  const resolvedPath = getConfigPath(configPath);
  let lastSignature = getFileSignature(resolvedPath);

  return {
    path: resolvedPath,
    reloadIfChanged(config) {
      const nextSignature = getFileSignature(resolvedPath);
      if (nextSignature === lastSignature) return false;

      const nextConfig = loadConfig(resolvedPath);
      replaceObject(config, nextConfig);
      lastSignature = nextSignature;
      return true;
    }
  };
}

function applyEnvOverrides(config) {
  if (process.env.ACS_PORT) config.port = Number(process.env.ACS_PORT);
  if (process.env.ACS_HOST) config.host = process.env.ACS_HOST;
  if (process.env.ACS_UPSTREAM_BASE_URL) {
    config.upstream.baseUrl = process.env.ACS_UPSTREAM_BASE_URL;
  }
}

function resolveRuntimePaths(config) {
  if (config.runtime?.logDir) config.runtime.logDir = resolveProjectPath(config.runtime.logDir);
  if (config.runtime?.stateDir) config.runtime.stateDir = resolveProjectPath(config.runtime.stateDir);
  if (config.state?.file) config.state.file = resolveProjectPath(config.state.file);
}

function resolveUpstreamSecrets(config) {
  fillApiKeyFromEnv(config.upstream, "ACS_UPSTREAM_API_KEY");

  const providers = config.models?.providers || {};
  for (const provider of Object.values(providers)) {
    fillApiKeyFromEnv(provider);
  }

  const routes = config.models?.routes || {};
  for (const route of Object.values(routes)) {
    if (route && typeof route === "object" && !Array.isArray(route)) {
      fillApiKeyFromEnv(route);
      fillApiKeyFromEnv(route.upstream);
    }
  }
}

function fillApiKeyFromEnv(upstream, fallbackEnvName = "") {
  if (!upstream || typeof upstream !== "object" || Array.isArray(upstream)) return;
  const envName = upstream.apiKeyEnv || "";
  if (!upstream.apiKey && envName && process.env[envName]) {
    upstream.apiKey = process.env[envName];
  }
  if (!upstream.apiKey && fallbackEnvName && process.env[fallbackEnvName]) {
    upstream.apiKey = process.env[fallbackEnvName];
  }
}

function resolveProjectPath(value) {
  if (!value || path.isAbsolute(value)) return value;
  return path.join(projectRoot, value);
}

function getFileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
  return target;
}
