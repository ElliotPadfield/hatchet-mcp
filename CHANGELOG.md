# Changelog

All notable changes to `hatchet-mcp` are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-24

### Added

- `find_unused_workflows` — report workflow definitions with no runs in a
  lookback window (default 30 days). Used to find retired/renamed tasks that
  still clutter the Hatchet dashboard.
- `get_workflow` — fetch one workflow definition by id.
- `delete_workflow` — permanently delete a workflow definition (requires
  `confirm: true`). Drops cron schedules on that definition. Destructive;
  description is prefixed `MUTATES LIVE STATE`.
- `list_workflows` now accepts optional `offset` and `name` filters.

## [0.1.1] - 2026-05-30

### Added

- `mcpName` field in package.json for [MCP Registry](https://registry.modelcontextprotocol.io)
  ownership verification (`io.github.ElliotPadfield/hatchet-mcp`).

## [0.1.0] - 2026-05-30

Initial release.

### Added

- Stdio MCP server (`npx hatchet-mcp`) wrapping the Hatchet REST API.
- Single-token configuration: `HATCHET_CLIENT_TOKEN` (a JWT) is decoded for the
  server URL and tenant, with optional `HATCHET_API_BASE` / `HATCHET_TENANT_ID`
  overrides for self-hosted instances.
- 10 tools, all verified against Hatchet Cloud:
  - Observability: `whoami`, `list_workflows`, `list_runs`, `get_run`,
    `get_run_logs`, `list_workers`, `get_queue_metrics`.
  - Actions: `trigger_workflow`, `cancel_runs`, `replay_runs`.
- HTTP error mapping that never leaks the token, and compact, token-efficient
  output formatting for runs, run detail, and logs.
