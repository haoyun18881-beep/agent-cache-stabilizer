# Agent Cache Stabilizer

Agent Cache Stabilizer, or ACS, is a local OpenAI-compatible proxy for agent
runtimes. It keeps long agent conversations friendlier to upstream prompt-cache
behavior by preserving stable message prefixes, separating main and sub-agent
lanes, and trimming old low-value context only after configurable waterlines are
exceeded.

ACS is not a long-term memory system, not a summarizer, and not an agent
orchestrator. It sits between an agent runtime and an OpenAI-compatible upstream
provider, then normalizes request context so repeated long sessions have a
better chance of reusing stable prefixes.

## Why This Exists

Long-running agent sessions often send a large, changing message array on every
model call. Small changes near the front of the array can reduce cache reuse and
make long tasks more expensive or less stable. ACS keeps the high-value prefix
stable where possible and moves low-value old context out of the active request
window when configured limits require it.

## Core Behavior

| Area | Behavior |
| --- | --- |
| API surface | Exposes an OpenAI-compatible `/v1/chat/completions` endpoint. |
| Upstream routing | Forwards requests to configured OpenAI-compatible providers. |
| Stable prefix | Preserves stable system, developer, and early-session messages where possible. |
| Lane separation | Separates main-agent and sub-agent traffic by headers, task IDs, or session keys. |
| Waterline trimming | Keeps recent useful context intact, then archives older low-value tool noise when limits are exceeded. |
| Provider mapping | Allows routing by model/provider configuration. |
| Local state | Stores only local runtime state needed for cache stabilization and recovery. |

## What ACS Does Not Do

- It does not store permanent user memory.
- It does not decide what an agent should do.
- It does not replace a project handoff, QA diary, or knowledge base.
- It does not remove the need to protect prompts, logs, and provider keys.

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
| `x-session-id` | Generic session ID. |
| `x-session-affinity` | Generic session affinity key. |
| `x-acs-lane` | Explicit lane, such as main or sub-agent. |
| `x-acs-task-id` | Task or sub-agent ID. |
| `x-acs-task-name` | Human-readable task name. |

`identity.openclawSessionStore` is optional. Leave it empty unless you have a
reviewed local OpenClaw session store path and explicitly want ACS to map
session IDs back to session keys.

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

## Package Boundary

The npm package includes source, tests, scripts, `config.example.json`,
`openclaw.plugin.json`, `README.md`, `LICENSE`, and `SECURITY.md`. It excludes
local runtime state, secrets, logs, backups, and project handoff files.

## License

Business Source License 1.1. See `LICENSE`.
