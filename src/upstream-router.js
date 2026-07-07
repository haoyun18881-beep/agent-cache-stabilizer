const upstreamKeys = new Set(["baseUrl", "apiKey", "apiKeyEnv", "headers"]);

export function resolveUpstreamForBody(body = {}, config = {}) {
  const model = typeof body?.model === "string" ? body.model : "";
  const models = config.models || {};
  const providers = models.providers || {};
  const routes = models.routes || {};
  const defaultUpstream = pickUpstream(config.upstream || {});
  const exactRoute = model ? routes[model] : null;

  if (exactRoute) {
    return resolveExactRoute({
      model,
      route: exactRoute,
      providers,
      defaultUpstream
    });
  }

  const providerName = matchProviderName(model, providers);
  if (providerName) {
    return {
      upstream: withDefaultBaseUrl(mergeUpstreams(providers[providerName]), defaultUpstream),
      providerName,
      routeName: providerName,
      routeType: "provider-prefix",
      targetModel: model
    };
  }

  return {
    upstream: defaultUpstream,
    providerName: "",
    routeName: "default",
    routeType: "default",
    targetModel: model
  };
}

function resolveExactRoute({ model, route, providers, defaultUpstream }) {
  if (typeof route === "string") {
    const provider = providers[route];
    if (provider) {
      return {
        upstream: withDefaultBaseUrl(mergeUpstreams(provider), defaultUpstream),
        providerName: route,
        routeName: model,
        routeType: "model-provider",
        targetModel: model
      };
    }
  }

  if (route && typeof route === "object" && !Array.isArray(route)) {
    const providerName = typeof route.provider === "string" ? route.provider : "";
    const provider = providerName ? providers[providerName] : null;
    const inlineUpstream = route.upstream || route;
    const targetModel = route.model || route.targetModel || model;

    return {
      upstream: withDefaultBaseUrl(mergeUpstreams(provider, inlineUpstream), defaultUpstream),
      providerName,
      routeName: model,
      routeType: providerName ? "model-provider" : "model-inline",
      targetModel
    };
  }

  return {
    upstream: defaultUpstream,
    providerName: "",
    routeName: "default",
    routeType: "default",
    targetModel: model
  };
}

function matchProviderName(model, providers) {
  if (!model) return "";
  const names = Object.keys(providers).sort((a, b) => b.length - a.length);
  return (
    names.find((name) => {
      return (
        model === name ||
        model.startsWith(`${name}/`) ||
        model.startsWith(`${name}:`) ||
        model.startsWith(`${name}-`)
      );
    }) || ""
  );
}

function withDefaultBaseUrl(upstream, defaultUpstream) {
  if (upstream.baseUrl) return upstream;
  return { ...upstream, baseUrl: defaultUpstream.baseUrl };
}

function mergeUpstreams(...upstreams) {
  const result = {};
  for (const upstream of upstreams) {
    const picked = pickUpstream(upstream);
    if (!Object.keys(picked).length) continue;

    if (picked.headers && typeof picked.headers === "object" && !Array.isArray(picked.headers)) {
      result.headers = { ...(result.headers || {}), ...picked.headers };
    }

    for (const key of ["baseUrl", "apiKey", "apiKeyEnv"]) {
      if (picked[key] !== undefined) result[key] = picked[key];
    }
  }
  return result;
}

function pickUpstream(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const picked = {};
  for (const [key, entry] of Object.entries(value)) {
    if (upstreamKeys.has(key)) picked[key] = entry;
  }
  return picked;
}
