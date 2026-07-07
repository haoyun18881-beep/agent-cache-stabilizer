import test from "node:test";
import assert from "node:assert/strict";
import { resolveUpstreamForBody } from "../src/upstream-router.js";

test("resolveUpstreamForBody uses the default upstream when no route matches", () => {
  const route = resolveUpstreamForBody(
    { model: "unknown-model" },
    {
      upstream: {
        baseUrl: "https://default.example/v1",
        apiKey: "default-key"
      },
      models: {
        providers: {},
        routes: {}
      }
    }
  );

  assert.equal(route.routeType, "default");
  assert.equal(route.upstream.baseUrl, "https://default.example/v1");
  assert.equal(route.upstream.apiKey, "default-key");
  assert.equal(route.targetModel, "unknown-model");
});

test("resolveUpstreamForBody maps exact model routes to providers", () => {
  const route = resolveUpstreamForBody(
    { model: "deepseek-v4-flash" },
    {
      upstream: {
        baseUrl: "https://default.example/v1"
      },
      models: {
        providers: {
          deepseek: {
            baseUrl: "https://deepseek.example/v1",
            apiKey: "deepseek-key"
          }
        },
        routes: {
          "deepseek-v4-flash": "deepseek"
        }
      }
    }
  );

  assert.equal(route.routeType, "model-provider");
  assert.equal(route.providerName, "deepseek");
  assert.equal(route.upstream.baseUrl, "https://deepseek.example/v1");
  assert.equal(route.upstream.apiKey, "deepseek-key");
  assert.equal(route.targetModel, "deepseek-v4-flash");
});

test("resolveUpstreamForBody supports provider prefixes and model rewrites", () => {
  const providerRoute = resolveUpstreamForBody(
    { model: "zhipu/glm-4.5" },
    {
      upstream: {
        baseUrl: "https://default.example/v1"
      },
      models: {
        providers: {
          zhipu: {
            baseUrl: "https://zhipu.example/api/paas/v4",
            apiKey: "zhipu-key"
          }
        },
        routes: {}
      }
    }
  );
  assert.equal(providerRoute.routeType, "provider-prefix");
  assert.equal(providerRoute.upstream.apiKey, "zhipu-key");
  assert.equal(providerRoute.targetModel, "zhipu/glm-4.5");

  const rewriteRoute = resolveUpstreamForBody(
    { model: "glm-via-acs" },
    {
      upstream: {
        baseUrl: "https://default.example/v1"
      },
      models: {
        providers: {
          zhipu: {
            baseUrl: "https://zhipu.example/api/paas/v4",
            apiKey: "zhipu-key"
          }
        },
        routes: {
          "glm-via-acs": {
            provider: "zhipu",
            model: "glm-4.5"
          }
        }
      }
    }
  );
  assert.equal(rewriteRoute.routeType, "model-provider");
  assert.equal(rewriteRoute.upstream.baseUrl, "https://zhipu.example/api/paas/v4");
  assert.equal(rewriteRoute.targetModel, "glm-4.5");
});
