import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("ACS proxies chat completions to a mock upstream and strips session headers", async () => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readJson(req);
    upstreamRequests.push({ headers: req.headers, body });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "chatcmpl_mock",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 5,
          total_tokens: 105,
          prompt_cache_hit_tokens: 90
        }
      })
    );
  });

  await listen(upstream, 0);
  const upstreamPort = upstream.address().port;
  const acsPort = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-test-"));
  const configPath = path.join(tempDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        port: acsPort,
        host: "127.0.0.1",
        upstream: {
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          apiKey: "test-key"
        },
        runtime: {
          logDir: path.join(tempDir, "logs"),
          stateDir: path.join(tempDir, "state")
        }
      },
      null,
      2
    )
  );

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      AGENT_CACHE_STABILIZER_CONFIG: configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(acsPort);
    const response = await fetch(`http://127.0.0.1:${acsPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "session-main"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "s" },
          { role: "user", content: "hello" }
        ]
      })
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.choices[0].message.content, "ok");
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].headers.session_id, undefined);
    assert.equal(upstreamRequests[0].headers.authorization, "Bearer test-key");
    assert.equal(upstreamRequests[0].body.messages.length, 2);

    const stateResponse = await fetch(`http://127.0.0.1:${acsPort}/state`);
    const stateJson = await stateResponse.json();
    assert.equal(stateJson.ok, true);
    assert.equal(stateJson.state.messages, 1);
  } finally {
    child.kill();
    upstream.close();
  }
});

test("ACS routes configured models to different upstream providers", async () => {
  const defaultRequests = [];
  const zhipuRequests = [];
  const defaultUpstream = createJsonUpstream(defaultRequests, "default-ok");
  const zhipuUpstream = createJsonUpstream(zhipuRequests, "zhipu-ok");

  await listen(defaultUpstream, 0);
  await listen(zhipuUpstream, 0);
  const defaultPort = defaultUpstream.address().port;
  const zhipuPort = zhipuUpstream.address().port;
  const acsPort = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-route-test-"));
  const configPath = path.join(tempDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        port: acsPort,
        host: "127.0.0.1",
        upstream: {
          baseUrl: `http://127.0.0.1:${defaultPort}/v1`,
          apiKey: "default-key"
        },
        models: {
          providers: {
            zhipu: {
              baseUrl: `http://127.0.0.1:${zhipuPort}/api/paas/v4`,
              apiKey: "zhipu-key"
            }
          },
          routes: {
            "glm-via-acs": {
              provider: "zhipu",
              model: "glm-4.5"
            }
          }
        },
        runtime: {
          logDir: path.join(tempDir, "logs"),
          stateDir: path.join(tempDir, "state")
        }
      },
      null,
      2
    )
  );

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      AGENT_CACHE_STABILIZER_CONFIG: configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(acsPort);
    const defaultResponse = await fetch(`http://127.0.0.1:${acsPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "session-main"
      },
      body: JSON.stringify({
        model: "unrouted-model",
        messages: [{ role: "user", content: "hello default" }]
      })
    });
    assert.equal(defaultResponse.status, 200);
    assert.equal((await defaultResponse.json()).choices[0].message.content, "default-ok");

    const zhipuResponse = await fetch(`http://127.0.0.1:${acsPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "session-main"
      },
      body: JSON.stringify({
        model: "glm-via-acs",
        messages: [{ role: "user", content: "hello zhipu" }]
      })
    });
    assert.equal(zhipuResponse.status, 200);
    assert.equal((await zhipuResponse.json()).choices[0].message.content, "zhipu-ok");

    assert.equal(defaultRequests.length, 1);
    assert.equal(zhipuRequests.length, 1);
    assert.equal(defaultRequests[0].headers.authorization, "Bearer default-key");
    assert.equal(zhipuRequests[0].headers.authorization, "Bearer zhipu-key");
    assert.equal(defaultRequests[0].body.model, "unrouted-model");
    assert.equal(zhipuRequests[0].body.model, "glm-4.5");
  } finally {
    child.kill();
    defaultUpstream.close();
    zhipuUpstream.close();
  }
});

test("ACS reloads config.json before forwarding the next request", async () => {
  const firstRequests = [];
  const secondRequests = [];
  const firstUpstream = createJsonUpstream(firstRequests, "first-ok");
  const secondUpstream = createJsonUpstream(secondRequests, "second-ok");

  await listen(firstUpstream, 0);
  await listen(secondUpstream, 0);
  const firstPort = firstUpstream.address().port;
  const secondPort = secondUpstream.address().port;
  const acsPort = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-hot-reload-test-"));
  const configPath = path.join(tempDir, "config.json");
  writeConfig(configPath, {
    port: acsPort,
    host: "127.0.0.1",
    upstream: {
      baseUrl: `http://127.0.0.1:${firstPort}/v1`,
      apiKey: "first-key"
    },
    runtime: {
      logDir: path.join(tempDir, "logs"),
      stateDir: path.join(tempDir, "state")
    }
  });

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      AGENT_CACHE_STABILIZER_CONFIG: configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(acsPort);
    const firstResponse = await fetch(`http://127.0.0.1:${acsPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "session-main"
      },
      body: JSON.stringify({
        model: "hot-model",
        messages: [{ role: "user", content: "first" }]
      })
    });
    assert.equal(firstResponse.status, 200);
    assert.equal((await firstResponse.json()).choices[0].message.content, "first-ok");

    writeConfig(configPath, {
      port: acsPort,
      host: "127.0.0.1",
      upstream: {
        baseUrl: `http://127.0.0.1:${firstPort}/v1`,
        apiKey: "first-key"
      },
      models: {
        providers: {
          second: {
            baseUrl: `http://127.0.0.1:${secondPort}/v1`,
            apiKey: "second-key"
          }
        },
        routes: {
          "hot-model": "second"
        }
      },
      runtime: {
        logDir: path.join(tempDir, "logs"),
        stateDir: path.join(tempDir, "state")
      }
    });

    const secondResponse = await fetch(`http://127.0.0.1:${acsPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "session-main"
      },
      body: JSON.stringify({
        model: "hot-model",
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "first-ok" },
          { role: "user", content: "second" }
        ]
      })
    });
    assert.equal(secondResponse.status, 200);
    assert.equal((await secondResponse.json()).choices[0].message.content, "second-ok");

    assert.equal(firstRequests.length, 1);
    assert.equal(secondRequests.length, 1);
    assert.equal(firstRequests[0].headers.authorization, "Bearer first-key");
    assert.equal(secondRequests[0].headers.authorization, "Bearer second-key");
  } finally {
    child.kill();
    firstUpstream.close();
    secondUpstream.close();
  }
});

test("ACS forwards streaming SSE responses from a mock upstream", async () => {
  const upstream = http.createServer(async (req, res) => {
    await readJson(req);
    res.writeHead(200, {
      "content-type": "text/event-stream"
    });
    res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n');
    res.write('data: {"usage":{"prompt_tokens":50,"completion_tokens":2,');
    res.write('"total_tokens":52,"prompt_cache_hit_tokens":40}}\n\n');
    res.end("data: [DONE]\n\n");
  });

  await listen(upstream, 0);
  const upstreamPort = upstream.address().port;
  const acsPort = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-stream-test-"));
  const configPath = path.join(tempDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        port: acsPort,
        host: "127.0.0.1",
        upstream: {
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          apiKey: "test-key"
        },
        runtime: {
          logDir: path.join(tempDir, "logs"),
          stateDir: path.join(tempDir, "state")
        }
      },
      null,
      2
    )
  );

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      AGENT_CACHE_STABILIZER_CONFIG: configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(acsPort);
    const response = await fetch(`http://127.0.0.1:${acsPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "session-main"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        stream: true,
        messages: [{ role: "user", content: "hello" }]
      })
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type").includes("text/event-stream"), true);
    const text = await response.text();
    assert.equal(text.includes('"content":"he"'), true);
    assert.equal(text.includes('"prompt_tokens":50'), true);
    assert.equal(text.includes("[DONE]"), true);
  } finally {
    child.kill();
    upstream.close();
  }
});

test("ACS preserves upstream error responses", async () => {
  const upstream = http.createServer(async (req, res) => {
    await readJson(req);
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "mock schema error" } }));
  });

  await listen(upstream, 0);
  const upstreamPort = upstream.address().port;
  const acsPort = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-error-test-"));
  const configPath = path.join(tempDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        port: acsPort,
        host: "127.0.0.1",
        upstream: {
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          apiKey: "test-key"
        },
        runtime: {
          logDir: path.join(tempDir, "logs"),
          stateDir: path.join(tempDir, "state")
        }
      },
      null,
      2
    )
  );

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      AGENT_CACHE_STABILIZER_CONFIG: configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(acsPort);
    const response = await fetch(`http://127.0.0.1:${acsPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "session-main"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "hello" }]
      })
    });

    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(json.error.message, "mock schema error");
  } finally {
    child.kill();
    upstream.close();
  }
});

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function createJsonUpstream(requests, content) {
  return http.createServer(async (req, res) => {
    const body = await readJson(req);
    requests.push({ headers: req.headers, body });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "chatcmpl_mock",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 1,
          total_tokens: 11
        }
      })
    );
  });
}

function writeConfig(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

async function getFreePort() {
  const server = http.createServer();
  await listen(server, 0);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("ACS server did not become healthy");
}
