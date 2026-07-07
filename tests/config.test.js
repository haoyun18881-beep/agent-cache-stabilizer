import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConfigReloader, loadConfig } from "../src/config.js";

test("loadConfig supports environment overrides", () => {
  const oldPort = process.env.ACS_PORT;
  const oldBaseUrl = process.env.ACS_UPSTREAM_BASE_URL;
  const oldKey = process.env.ACS_UPSTREAM_API_KEY;
  const oldDeepSeekKey = process.env.DEEPSEEK_API_KEY;

  process.env.ACS_PORT = "19991";
  process.env.ACS_UPSTREAM_BASE_URL = "http://127.0.0.1:19992/v1";
  process.env.ACS_UPSTREAM_API_KEY = "env-key";
  delete process.env.DEEPSEEK_API_KEY;

  try {
    const config = loadConfig("__missing_config__.json");
    assert.equal(config.port, 19991);
    assert.equal(config.upstream.baseUrl, "http://127.0.0.1:19992/v1");
    assert.equal(config.upstream.apiKey, "env-key");
    assert.equal(config.state.enabled, false);
    assert.equal(config.state.file.endsWith("state\\main-state.json") || config.state.file.endsWith("state/main-state.json"), true);
  } finally {
    restoreEnv("ACS_PORT", oldPort);
    restoreEnv("ACS_UPSTREAM_BASE_URL", oldBaseUrl);
    restoreEnv("ACS_UPSTREAM_API_KEY", oldKey);
    restoreEnv("DEEPSEEK_API_KEY", oldDeepSeekKey);
  }
});

test("loadConfig resolves provider and route API keys from configured env names", () => {
  const oldProviderKey = process.env.TEST_PROVIDER_KEY;
  const oldRouteKey = process.env.TEST_ROUTE_KEY;

  process.env.TEST_PROVIDER_KEY = "provider-secret";
  process.env.TEST_ROUTE_KEY = "route-secret";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-config-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        models: {
          providers: {
            example: {
              baseUrl: "https://provider.example/v1",
              apiKeyEnv: "TEST_PROVIDER_KEY"
            }
          },
          routes: {
            "example-model": {
              baseUrl: "https://route.example/v1",
              apiKeyEnv: "TEST_ROUTE_KEY"
            }
          }
        }
      })
    );

    const resolved = loadConfig(configPath);
    assert.equal(resolved.models.providers.example.apiKey, "provider-secret");
    assert.equal(resolved.models.routes["example-model"].apiKey, "route-secret");
  } finally {
    restoreEnv("TEST_PROVIDER_KEY", oldProviderKey);
    restoreEnv("TEST_ROUTE_KEY", oldRouteKey);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createConfigReloader mutates the live config object when config.json changes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-reload-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        waterline: {
          trimTriggerTokens: 320000
        },
        logging: {
          logUpstreamRoute: false
        }
      })
    );

    const config = loadConfig(configPath);
    const reloader = createConfigReloader(configPath);
    assert.equal(config.waterline.trimTriggerTokens, 320000);
    assert.equal(config.logging.logUpstreamRoute, false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        waterline: {
          trimTriggerTokens: 150000
        },
        logging: {
          logUpstreamRoute: true
        }
      })
    );

    assert.equal(reloader.reloadIfChanged(config), true);
    assert.equal(config.waterline.trimTriggerTokens, 150000);
    assert.equal(config.logging.logUpstreamRoute, true);
    assert.equal(config.waterline.recentFullTokens, 120000);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
