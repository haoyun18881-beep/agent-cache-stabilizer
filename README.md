# Agent Cache Stabilizer

> **它能在请求发给 LLM 之前重写上下文，让缓存命中长期稳定在作者实测的97%+，直接减少重复输入 Token 和 Agent 成本。**

Agent Cache Stabilizer（ACS）是一个本地、OpenAI 兼容的上下文稳定层。任何能调用 OpenAI 兼容接口的 Agent，都可以把请求先交给 ACS；ACS 会自己整理、修复并重建发给模型的 `messages`。

## 它最有价值的地方

### 1. 实打实稳定缓存命中，直接省钱

作者在长期工程运行中的实测缓存命中稳定在97%以上。大量重复的系统提示、身份、规则和早期上下文可以继续命中上游 Prompt Cache，不必每轮重新付完整输入成本。

### 2. 它真的能改写发给 LLM 的上下文

ACS 不是只做监控。它在请求发送前拆分稳定前缀、主 Agent 上下文和子 Agent 流量，再按水位线重建最终 `messages`。

### 3. 几乎任何 Agent 框架都能接

只要客户端支持 OpenAI 兼容接口，就可以把 `/v1/chat/completions` 指向 ACS，再由 ACS 转发到真实模型服务。

### 4. 主 Agent 不会被子 Agent 上下文污染

主会话和子任务使用不同 Lane（通道）。子 Agent 可以正常工作，但不会反复改写主 Agent 的长期上下文相册。

### 5. 旧工具噪声按水位线自动整理

最近的重要决策保持完整；更老的工具输出和低价值噪声先压缩归档，超过阈值后再丢弃，不必粗暴清空整段历史。

### 6. 损坏的工具调用链可以自动修复

缺失的 tool result、孤立的工具消息和不符合上游格式的调用链，可以在转发前修成模型能够接受的结构。

### 7. 模型路由、流式转发和热更新一起解决

ACS 可以按模型名、Provider（服务商）前缀或默认路由转发请求，同时支持 SSE 流式响应和配置热加载。

### 8. 需要远古历史召回时，已经有文档化扩展点

公开版本不内置召回后端，也不把它做成默认开关；README 已给出 Optional Memory Recall（可选记忆召回）扩展方案：把用户输入交给本地关键词或向量索引，取回少量历史片段，再注入上下文。作者没有默认开启，因为日常代码工程不需要远古历史，而且动态召回会让缓存命中略降；需要长期人格或知识记忆的用户，可以让自己的 Agent 按这个扩展点加上。

## 最简单的用法

1. 启动 ACS；
2. 把 Agent 的 OpenAI Base URL 指向 ACS；
3. ACS 自动重写上下文并转发到真实模型。

```text
Agent -> ACS -> OpenAI-compatible model provider
```

如果你需要远古历史召回，可以直接告诉 Agent：

```text
按照 README 的 Optional Memory Recall Extension，
给 ACS 接一个本地日记/向量索引，只注入少量有来源的历史片段。
```

97%+ 是作者真实运行中的观测值，不是固定协议保证；具体命中率仍取决于上游模型服务、请求形状和集成方式。

## English quick overview

ACS rewrites outbound LLM context before each request. It stabilizes the prompt prefix, separates main/sub-agent lanes, compacts old tool noise by waterlines, repairs broken tool chains, and routes requests to OpenAI-compatible providers.

The author has observed **97%+ prompt-cache hit rates** in long-running engineering workloads. Optional diary/vector recall can be added through the documented extension point when long-range memory matters more than the last percentage point of cache stability.

## Mental Model

Think of ACS as a water tank for the main agent conversation:

```text
stable prefix
  system / developer / early identity messages

main lane album
  recent useful context kept in full
  older low-value context archived into compact shapes
  excess context dropped after waterline policy

sub-agent lane
  passed through by identity
  does not rewrite the main album
```

The goal is not to summarize everything. The goal is to preserve the parts that
make cache reuse and agent continuity more likely, while reducing old noise that
does not deserve to stay in the live request.

## Core Behavior

| Area | Behavior |
| --- | --- |
| API surface | Exposes an OpenAI-compatible `/v1/chat/completions` endpoint. |
| Upstream routing | Forwards requests to configured OpenAI-compatible providers. |
| Stable prefix | Preserves stable system, developer, and early-session messages where possible. |
| Lane separation | Separates main-agent and sub-agent traffic by headers, task IDs, user field, or session keys. |
| Compaction handling | Detects short agent compaction requests and keeps the internal main album when it is still the same session. |
| Waterline trimming | Keeps recent context full, archives older low-value tool noise, and drops excess after thresholds. |
| Tool-chain repair | Inserts compact placeholders for missing tool results and synthetic assistants for orphan tool messages. |
| Provider mapping | Allows routing by exact model name, provider prefix, inline route, or default upstream. |
| Streaming | Pipes SSE responses through while continuing to observe usage events when present. |
| State endpoint | Provides `/state` for the current main-lane waterline summary. |

## What ACS Does Not Do

- It does not store permanent user memory.
- It does not decide what an agent should do.
- It does not replace a project handoff, QA diary, vector database, or knowledge
  graph.
- It does not make private prompts, logs, or provider keys safe to publish.

ACS handles cache shape and request hygiene. Long-term memory still belongs in a
separate storage and retrieval system.

## Optional Memory Recall Extension

Some users may prefer a stronger long-term-memory style: every user turn can be
matched against a local diary or knowledge index, then a small recalled snippet
can be injected into the next model request.

ACS does not ship that as the default behavior because dynamic recall changes
the request prefix and can reduce cache friendliness. It is intentionally kept
as an extension point.

To build this extension, you need:

- a conversation diary or event logger that stores your own chat history
- redaction rules before anything becomes searchable memory
- an embedding model or keyword/FTS indexer
- a vector index or search store
- a retriever that returns very small, sourced snippets
- an ACS or client-side adapter that injects those snippets into the request
  after the stable prefix

With a local index, recall can be fast enough for interactive use, but the host
must balance three things: recall quality, privacy, and prompt-cache stability.
For long project work, a good pattern is to keep ACS responsible for cache shape
and use a separate memory system for only the few facts that are worth injecting.

## When To Use It

ACS is useful when:

- an agent runtime repeatedly sends long OpenAI-style chat requests
- prompt-cache behavior matters
- main-agent and sub-agent traffic should be separated
- tool output is growing faster than the useful decision context
- you want to delay or avoid brittle native compaction in long sessions
- upstream providers are OpenAI-compatible but need different routes or model
  names
- you want a local, inspectable proxy rather than a black-box hosted layer

It is less useful for short one-shot chats, pure retrieval systems, or workloads
where every request is intentionally unrelated to the last one.

## Architecture

```text
agent runtime
  -> http://127.0.0.1:18801/v1/chat/completions
      -> identity resolver
      -> waterline manager
      -> tool-chain repair
      -> upstream router
      -> OpenAI-compatible provider
```

Supporting modules:

| Path | Purpose |
| --- | --- |
| `src/server.js` | HTTP surface, health, reset, state, and chat completion routing. |
| `src/identity.js` | Main/sub/task lane identity resolution. |
| `src/waterline.js` | Stable prefix, append/compaction detection, trim policy, and outbound message build. |
| `src/archive.js` | Compact archive shapes for old tool-heavy or noisy messages. |
| `src/tool-chain.js` | Provider-safe repair for missing or orphaned tool messages. |
| `src/upstream-router.js` | Exact model, provider-prefix, inline, and default routing. |
| `src/upstream.js` | Forwarding, streaming passthrough, headers, and usage observation. |
| `src/state-persister.js` | Optional local persisted waterline state. |
| `scripts/acs-observe.ps1` | Local observation script for health, waterline, and recent task activity. |

## Requirements

- Node.js 20 or newer.
- An OpenAI-compatible upstream endpoint.
- Provider credentials supplied through environment variables or a local
  untracked `config.json`.

## Install

```powershell
git clone https://github.com/haoyun18881-beep/agent-cache-stabilizer.git
cd agent-cache-stabilizer
npm install
npm run lint
npm test
```

Create a local config from the example:

```powershell
Copy-Item config.example.json config.json
```

Set provider credentials in the environment:

```powershell
$env:DEEPSEEK_API_KEY = "<your key>"
```

Do not commit `config.json` or `.env`.

## Run

```powershell
npm start
```

By default ACS listens on:

```text
http://127.0.0.1:18801
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:18801/health
```

State check:

```powershell
Invoke-RestMethod http://127.0.0.1:18801/state
```

Example completion request:

```powershell
$body = @{
  model = "deepseek-v4-flash"
  messages = @(
    @{ role = "system"; content = "You are a careful local test assistant." },
    @{ role = "user"; content = "Say hello." }
  )
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:18801/v1/chat/completions `
  -ContentType "application/json" `
  -Body $body
```

## Configuration

ACS reads `config.json` from the project root by default. You can override the
config path with either variable:

| Variable | Purpose |
| --- | --- |
| `ACS_CONFIG` | Explicit config file path. |
| `AGENT_CACHE_STABILIZER_CONFIG` | Alternate explicit config file path. |

Common environment overrides:

| Variable | Purpose |
| --- | --- |
| `ACS_PORT` | Listening port. |
| `ACS_HOST` | Listening host. |
| `ACS_UPSTREAM_BASE_URL` | Upstream OpenAI-compatible base URL. |
| `ACS_UPSTREAM_API_KEY` | Upstream API key. Prefer provider-specific variables when available. |

Provider API keys should normally come from environment variables such as
`DEEPSEEK_API_KEY` or `ZHIPU_API_KEY`. Keep real keys out of repository files.

## Waterline Settings

The default policy is intentionally conservative:

| Setting | Default | Meaning |
| --- | --- | --- |
| `recentFullTokens` | `120000` | Recent main-lane context kept in full. |
| `archiveQaTokens` | `80000` | Older archived context retained in compact form. |
| `trimTriggerTokens` | `320000` | Token estimate that triggers trimming. |
| `trimTargetTokens` | `200000` | Intended post-trim working range. |
| `archivedToolPrefixChars` | `20` | Prefix length kept for archived tool-heavy messages. |

These are estimates, not provider billing guarantees. They are designed to keep
the request shape stable enough for long tasks while making old low-value tool
noise cheaper to carry.

## Agent Runtime Integration

Point an OpenAI-compatible client at ACS:

```json
{
  "baseUrl": "http://127.0.0.1:18801/v1"
}
```

If your runtime can send session headers, ACS recognizes:

| Header | Purpose |
| --- | --- |
| `x-openclaw-session-key` | Stable OpenClaw session key. |
| `x-openclaw-session-id` | OpenClaw session ID. |
| `x-session-key` | Generic stable session key. |
| `x-session-id` | Generic session ID. |
| `x-session-affinity` | Generic session affinity key. |
| `x-acs-lane` | Explicit lane, such as `main`, `sub`, or `task`. |
| `x-acs-task-id` | Task or sub-agent ID. |
| `x-acs-task-name` | Human-readable task name. |
| `x-acs-batch-name` | Batch name for grouped activity. |
| `x-acs-group-name` | Group name for grouped activity. |

`identity.openclawSessionStore` is optional. Leave it empty unless you have a
reviewed local OpenClaw session store path and explicitly want ACS to map
session IDs back to session keys.

## Provider Routing

`config.example.json` shows three routing styles:

- default upstream for all unmatched models
- provider routes such as `deepseek-*`
- exact model routes with target-model rewrites, such as `zhipu/glm-4.5` to
  `glm-4.5`

This lets a single local endpoint route different model names to different
OpenAI-compatible providers without changing the calling agent's integration
pattern.

## Runtime Files

These files are local runtime data and must not be committed:

- `config.json`
- `.env` or `.env.*`
- `logs/`
- `state/`
- `backups/`
- request/response dumps
- provider keys, cookies, tokens, Authorization headers, or private prompts

## Scripts

```powershell
npm run lint
npm test
npm start
npm pack --dry-run
```

Optional observation:

```powershell
powershell -File scripts/acs-observe.ps1
```

The observe script checks local ACS and sidecar health, current MAIN waterline
state, recent logs, and recent task artifacts. It does not dispatch agents and
does not call the upstream model provider.

## Package Boundary

The npm package includes source, tests, scripts, `config.example.json`,
`openclaw.plugin.json`, `README.md`, `LICENSE`, and `SECURITY.md`. It excludes
local runtime state, secrets, logs, backups, and project handoff files.

## License

Business Source License 1.1. See `LICENSE`.
