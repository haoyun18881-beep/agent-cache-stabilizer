# Security

## Supported Scope

This project is a local proxy for OpenAI-compatible requests. Treat all prompts, tool outputs, logs, state files, and API keys as sensitive unless you have reviewed them.

## Do Not Commit

- `config.json`
- `.env` or `.env.*`
- `logs/`
- `state/`
- `backups/`
- request/response dumps
- API keys, cookies, tokens, Authorization headers, or private configuration values

## Reporting Issues

When reporting a security issue, do not include real API keys, private prompts, full request dumps, cookies, tokens, or other credentials. Include only the minimum redacted reproduction details needed to identify the problem.

## Local Defaults

The example configuration uses empty API-key fields and environment-variable names. `identity.openclawSessionStore` is optional and empty by default so a published copy does not point at a private local OpenClaw path.
