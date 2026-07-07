# Agent Cache Stabilizer

Agent Cache Stabilizer, or ACS, is a local OpenAI-compatible proxy for agent runtimes. It keeps long agent conversations cache-friendly by preserving stable message prefixes, separating main and sub-agent lanes, and trimming old context only when configurable waterlines are exceeded.

ACS is not a long-term memory system and it is not a summarizer. Its job is to make upstream model calls more stable for prompt-cache behavior while keeping recent work intact.

## What It Does

- Exposes an OpenAI-compatible `/v1/chat/completions` endpoint.
- Forwards requests to a configured upstream model provider.
- Keeps a stable prefix for main-session requests when possible.
- Separates main-agent and sub-agent traffic by session or task headers.
- Preserves recent messages fully, then archives older low-value tool noise when context exceeds waterline thresholds.
- Supports provider routing by model name.
- Supports local runtime state, logs, and config reload.

## Requirements

- Node.js 20 or newer.
- An OpenAI-compatible upstream endpoint.
- An API key supplied by environment variable or local `config.json`.

## Quick Start

```powershell
Copy-Item config.example.json config.json
$env:DEEPSEEK_API_KEY = "<your key>"
npm install
npm test
npm start
```

ACS listens on `127.0.0.1:18801` by default.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:18801/health
```

Example request:

```powershell
$body = @{
  model = "deepseek-v4-flash"
  messages = @(@{ role = "user"; content = "hello" })
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:18801/v1/chat/completions `
  -ContentType "application/json" `
  -Body $body
```

## Configuration

ACS reads `config.json` from the project root by default. You can also set:

- `ACS_CONFIG`
- `AGENT_CACHE_STABILIZER_CONFIG`

Useful environment overrides:

- `ACS_PORT`
- `ACS_HOST`
- `ACS_UPSTREAM_BASE_URL`
- `ACS_UPSTREAM_API_KEY`

Provider API keys should normally come from environment variables such as `DEEPSEEK_API_KEY` or `ZHIPU_API_KEY`. Do not commit `config.json`.

## OpenClaw Integration

Point an OpenAI-compatible provider base URL at ACS:

```json
{
  "baseUrl": "http://127.0.0.1:18801/v1"
}
```

If your runtime can send session headers, ACS recognizes headers such as:

- `x-openclaw-session-key`
- `x-openclaw-session-id`
- `x-session-id`
- `x-session-affinity`
- `x-acs-lane`
- `x-acs-task-id`
- `x-acs-task-name`

`identity.openclawSessionStore` is optional. Leave it empty unless you have a local OpenClaw session store path and explicitly want ACS to map session IDs back to session keys.

## Scripts

```powershell
npm run lint
npm test
npm start
```

## Runtime Files

These files are local runtime data and should not be committed:

- `config.json`
- `logs/`
- `state/`
- `backups/`
- `.env`

## License

MIT.
