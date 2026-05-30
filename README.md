# hatchet-mcp

[![CI](https://github.com/elliotpadfield/hatchet-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/elliotpadfield/hatchet-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hatchet-mcp.svg)](https://www.npmjs.com/package/hatchet-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

An MCP server that lets AI agents observe and operate [Hatchet](https://hatchet.run) workflows — status, runs, logs, workers, and metrics, plus trigger / cancel / replay.

**Why:** Hatchet has a great API but no MCP. This wraps it so agents (Claude Code / Desktop, etc.) can see and act on workflow state.

## Install

Add this to your Claude Code / Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "hatchet": {
      "command": "npx",
      "args": ["-y", "hatchet-mcp"],
      "env": { "HATCHET_CLIENT_TOKEN": "<your-hatchet-api-token>" }
    }
  }
}
```

Get the token from the Hatchet dashboard → **API tokens**. The token is a JWT that encodes the server URL and tenant, so it's the only required setting.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `HATCHET_CLIENT_TOKEN` | Yes | Hatchet API token (JWT). Encodes the server URL + tenant, so it's normally all you need. |
| `HATCHET_API_BASE` | No | Override the API base URL. Self-hosters can point this at any Hatchet instance. |
| `HATCHET_TENANT_ID` | No | Override the tenant id decoded from the token. |

Self-hosting? Set `HATCHET_API_BASE` to your own Hatchet instance and it works anywhere.

## Tools

### Observability (read-only)

| Tool | Description |
| --- | --- |
| `whoami` | Show the resolved Hatchet tenant + server URL and confirm the token works. |
| `list_workflows` | List workflow definitions for the tenant. |
| `list_runs` | List workflow runs (with an optional lookback window and filters). |
| `get_run` | Get the full detail of one workflow run — status, tasks, errors. |
| `get_run_logs` | Get log lines for a task by its external id. |
| `list_workers` | List workers and their status. |
| `get_queue_metrics` | Get task/queue metrics for the tenant (queue health). |

### Actions (mutate live state)

| Tool | Description |
| --- | --- |
| `trigger_workflow` | Trigger a new workflow run by name with a JSON input payload. |
| `cancel_runs` | Cancel one or more runs/tasks by external id. |
| `replay_runs` | Replay/retry one or more runs/tasks by external id. |

## Safety

The read tools (`whoami`, `list_workflows`, `list_runs`, `get_run`, `get_run_logs`, `list_workers`, `get_queue_metrics`) are non-destructive.

`trigger_workflow`, `cancel_runs`, and `replay_runs` **mutate live state** — their descriptions are prefixed `MUTATES LIVE STATE` so agents and users know they affect real runs.

The token grants full tenant access — treat it as a secret. Never commit it to source control.

## Development

```bash
pnpm install
pnpm test    # vitest
pnpm build   # tsup -> dist/index.js
```

TypeScript / ESM, tested with [vitest](https://vitest.dev).

## Status

v0.1.0 — all tools verified against Hatchet Cloud; works with self-hosted instances via `HATCHET_API_BASE`. `trigger_workflow` uses the stable `/workflow-runs/trigger` endpoint.
