# Agent Cache Stabilizer

Agent Cache Stabilizer, or ACS, is a local OpenAI-compatible context
stabilizer for long-running agent runtimes. It sits between an agent and an
OpenAI-compatible upstream provider, then reshapes the outgoing message stream
so the high-value prefix stays stable, sub-agent traffic does not pollute the
main lane, and old low-value tool noise is compacted only after configured
waterlines are exceeded.

The short version: ACS is not a memory database. It is a cache-shape and
context-hygiene layer for agents that keep working for a long time.

It was built for the failure mode where an agent seems fine for a while, then a
native compaction pass or noisy tool history changes the active context enough
that the model starts losing earlier intent. ACS keeps the request shape calmer
so long-running sessions can continue without constantly opening a new chat.

## Why This Exists

Long agent sessions usually resend a large `messages` array on every model
call. That creates three practical problems:

- Small changes near the front of the array can reduce upstream prompt-cache
  reuse.
- Sub-agent or task traffic can leak into the main agent's active context.
- Old tool output can grow until the next request becomes expensive, fragile, or
  too noisy for the model to use well.

ACS is built to keep the useful context shape stable while letting the session
continue.

## What Makes ACS Different

| Strength | What it means |
| --- | --- |
| OpenAI-compatible surface | Existing clients can point `/v1/chat/completions` at ACS instead of directly at the provider. |
| Stable prefix preservation | System, developer, and early-session messages are kept as a stable prefix where possible. |
| Main/sub-agent lane separation | Explicit headers and session identity let sub-agent traffic pass through without rewriting the main album. |
| Waterline trimming | ACS keeps recent context full, archives older low-value tool noise, and drops only after configured token thresholds. |
| Tool-chain repair | Missing tool results and orphan tool messages can be repaired into provider-acceptable chains. |
| Session identity recovery | Session keys can come from OpenClaw headers, generic headers, task IDs, request `user`, or an optional session store. |
| Streaming passthrough | Server-sent event streams are forwarded while usage metadata is still observed when available. |
| Model/provider routing | Requests can route by exact model or provider prefix, with target-model rewrites when needed. |
| Hot config reload | Config changes are detected between requests without restarting the process. |
| Local state option | ACS can persist its waterline state locally for recovery, while keeping credentials out of the repository. |

## Cache and Continuity Strategy

ACS focuses on the parts of context management that are hard for an agent prompt
to control directly:

- keep stable identity and policy messages near the front
- separate main-agent and sub-agent request lanes
- avoid rewriting the main album for unrelated task traffic
- compact old low-value tool noise after waterlines
- preserve recent decision context in full
- repair tool-call chains into provider-acceptable shape

In practice this can reduce accidental cache churn and make long-running agent
sessions feel less fragile. Cache behavior still depends on the upstream
provider, model, request shape, and runtime integration; ACS gives the host a
local layer to make that shape more predictable.

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
