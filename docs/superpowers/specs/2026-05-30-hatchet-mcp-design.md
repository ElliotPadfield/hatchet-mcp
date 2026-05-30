# Hatchet MCP — Design Spec

**Date:** 2026-05-30
**Status:** Approved (brainstorming) — pending spec review
**Package:** `hatchet-mcp` (npm name confirmed available)

## Summary

A Model Context Protocol server that wraps the Hatchet REST API so that AI
agents (and humans via Claude Code / Claude Desktop) can observe and safely
operate Hatchet workflows: see workflow definitions, query run status, read
logs/events, inspect workers and queue health, and trigger / cancel / replay
runs. Distributed publicly as a local stdio MCP server run via `npx`.

There is no existing Hatchet MCP. Hatchet exposes a clean REST API (OpenAPI
spec at
`https://raw.githubusercontent.com/hatchet-dev/hatchet/main/api-contracts/openapi/openapi.yaml`),
which this project wraps.

## Goals

- Let an agent answer "what's the status of my workflows / this run / why did
  it fail" and act on it (trigger, cancel, replay) without leaving the chat.
- One-paste setup: a single `HATCHET_CLIENT_TOKEN` env var.
- Work against both Hatchet Cloud and self-hosted instances.
- Ship as a tiny, dependency-light public npm package.

## Non-Goals (v1)

- Remote / hosted connector (token-proxying). Architecture stays
  transport-agnostic so a remote HTTP entry point can be added later, but v1 is
  stdio only.
- Destructive admin operations: delete tenant, rotate API keys, manage members.
- Cron / scheduled-run management (create/list/delete). Deferred to a later
  version.
- Depending on the Hatchet SDK or its gRPC client. We hit REST directly.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Transport | stdio (local, npx). Remote proxying rejected — only viable if run by Hatchet themselves. |
| Target instance | Both Cloud + self-hosted, configurable. |
| Op scope | Read + safe writes (trigger/cancel/replay). No destructive admin. |
| Language/runtime | TypeScript, distributed via `npx hatchet-mcp`. |
| Cron/schedule tools | Out of v1. |
| Package name | `hatchet-mcp` (unscoped; confirmed unclaimed on npm). |

## Architecture

```
hatchet-mcp/
  src/
    index.ts          # stdio entry — wires StdioServerTransport to the server
    server.ts         # transport-agnostic McpServer + tool registration
    hatchet/
      auth.ts         # decode JWT token -> {serverUrl, tenantId}; env overrides
      client.ts       # typed fetch wrapper over Hatchet REST (Bearer auth)
      types.ts        # hand-written types for the responses we surface
    tools/
      observability.ts # whoami, workflows, runs, logs, events, workers, metrics
      actions.ts        # trigger / cancel / replay
    format.ts         # shape API JSON -> compact, token-efficient output
  test/
    auth.test.ts
    format.test.ts
    fixtures/         # recorded API responses (token scrubbed)
  package.json        # bin: hatchet-mcp
  README.md
  LICENSE             # MIT
```

**Transport-agnostic core.** `server.ts` builds the `McpServer` and registers
all tools against a `HatchetClient`. `index.ts` is the only stdio-specific
file. Adding a remote transport later is additive — no tool rewrites.

**Dependencies:** `@modelcontextprotocol/sdk`, `zod` (tool input schemas). No
HTTP library beyond the runtime `fetch`. Dev: `typescript`, `tsx`/`tsup` for
build, `vitest` for tests.

## Config / Auth

- **Required:** `HATCHET_CLIENT_TOKEN` — the Hatchet client token (JWT).
- **Optional overrides:**
  - `HATCHET_API_BASE` — REST base URL override (self-hosters, proxies).
  - `HATCHET_TENANT_ID` — tenant override.

On startup, `auth.ts` base64-decodes the JWT payload and reads the server URL
and tenant claims. **Confirmed against a live Cloud token (2026-05-30):**

- `server_url` claim → REST base URL (e.g. `https://cloud.onhatchet.run`)
- `sub` claim → tenant/org id

Resolution precedence: explicit env override > token claim. If neither yields a
value, startup fails with a clear message naming the missing piece.

Auth header on every request: `Authorization: Bearer <HATCHET_CLIENT_TOKEN>`.
**Verified live:** `GET /api/v1/tenants/{sub}/workflows` returns `200` with this
header and the `sub` claim as tenant.

The token is never echoed in tool output or error messages.

## Tool Surface

Tools are consolidated into agent-shaped operations rather than a 1:1 mapping of
the ~40 REST endpoints, to keep the tool list legible and context-efficient.

### Observability (read)

| Tool | Purpose | Primary endpoint(s) |
|---|---|---|
| `whoami` | Resolved tenant + server URL; connection sanity check | Decoded token claims + a `list workflows?limit=1` liveness ping. **Do NOT use `/api/v1/users/current`** — confirmed `403` with a tenant API token. |
| `list_workflows` | Workflow definitions for the tenant; name filter, pagination | `GET /api/v1/tenants/{tenant}/workflows` |
| `get_workflow` | One workflow: versions + metrics | `GET /api/v1/workflows/{workflow}`, `/versions`, `/metrics` |
| `list_runs` | **Workhorse.** Runs filtered by status / workflow / time window / limit | `GET /api/v1/tenants/{tenant}/workflow-runs` |
| `get_run` | One run's full picture: status + task tree/shape + input + timings | `GET /api/v1/workflow-runs/{id}` (+ `/status`, `/task-timings`), `GET /api/v1/tenants/{tenant}/workflow-runs/{id}/shape`, `/input` |
| `get_run_logs` | Logs / step events for a run's steps | `GET /api/v1/tenants/{tenant}/workflow-runs/{id}/step-run-events`, step-run events/logs |
| `list_events` | Recent events + event keys | `GET /api/v1/tenants/{tenant}/events`, `/events/keys` |
| `list_workers` | Workers and their status | `GET /api/v1/tenants/{tenant}/worker`, `GET /api/v1/workers/{worker}` |
| `get_queue_metrics` | Queue + step-run-queue health | `GET /api/v1/tenants/{tenant}/queue-metrics`, `/step-run-queue-metrics` |

### Safe writes

| Tool | Purpose | Primary endpoint(s) |
|---|---|---|
| `trigger_workflow` | Start a run with JSON input | `POST /api/v1/tenants/{tenant}/workflow-runs/trigger` (or `POST /api/v1/workflows/{workflow}/trigger`) |
| `cancel_runs` | Cancel one or more runs by id | `POST /api/v1/tenants/{tenant}/workflows/cancel` |
| `replay_runs` | Replay/retry one or more runs by id | `POST /api/v1/tenants/{tenant}/workflow-runs/replay` |

Every tool takes a `zod` input schema with a clear description. Write tools
state plainly in their description that they mutate live workflow state.

## Data Flow

1. MCP client (Claude) invokes a tool with validated args.
2. Tool handler calls a `HatchetClient` method, injecting tenant id where the
   endpoint is tenant-scoped.
3. `HatchetClient` issues an authenticated `fetch`, maps non-2xx to typed
   errors.
4. `format.ts` reduces the response to compact output (ids, status,
   timestamps, durations, error messages). A `verbose: true` arg returns raw
   JSON where the full payload is useful (e.g. `get_run`).

## Error Handling

`HatchetClient` maps HTTP status to clear MCP tool errors:

- `401` → "Hatchet token is invalid or expired."
- `403` → "Token lacks permission for this tenant/resource."
- `404` → "Not found — check the id and that HATCHET_TENANT_ID matches the token's tenant."
- `429` → "Rate limited by Hatchet; retry later." (surface `Retry-After` if present)
- `5xx` → "Hatchet API error (HTTP {status}). Body: {trimmed}."

The token value never appears in any error string. Network failures surface as
a clear "could not reach Hatchet at {base}" message.

## Output Shaping (`format.ts`)

- `list_runs` / `list_events` / `list_workers`: one compact line/object per
  item — never dump full raw arrays by default.
- `get_run`: structured summary (run status, per-task status + duration + error)
  with `verbose` for raw shape/input.
- Timestamps passed through as ISO strings; durations computed to ms/s where
  the API gives start/end.

## Testing

- **Unit (no network):**
  - `auth.test.ts` — JWT decode, override precedence, missing-value failure
    messages.
  - `format.test.ts` — golden tests against recorded fixtures in
    `test/fixtures/` (token scrubbed) for each list/detail shaper.
- **Integration (optional, gated):** a smoke test that runs only when a real
  `HATCHET_CLIENT_TOKEN` is present in the env — calls `whoami` + `list_runs`
  against a live instance. Skipped in CI by default.

## Release Plan

- Public GitHub repo, MIT license.
- npm package `hatchet-mcp` with a `bin` entry → `npx hatchet-mcp`.
- README: what it is, one-paste Claude Code / Desktop config block with the
  token env var, tool reference table, self-hosted override notes.
- Stretch: submit to the MCP registry and share with the Hatchet community.

## Verified API Mapping (live probe, 2026-05-30)

The current API is the **`/api/v1/stable/...`** namespace. Several legacy
endpoints referenced above are deprecated; the table below is the authoritative
mapping the implementation targets. `✓live` = confirmed `200` against the
user's Cloud tenant with the Bearer token.

| Tool | Method + Path | Notes |
|---|---|---|
| `whoami` | (token decode) + `list_workflows?limit=1` | `/users/current` → 403, do not use |
| `list_workflows` | `GET /api/v1/tenants/{t}/workflows` ✓live | `{pagination, rows[]}` |
| `get_workflow` | `GET /api/v1/workflows/{workflow}` (+ `/versions`, `/metrics`) | |
| `list_runs` | `GET /api/v1/stable/tenants/{t}/workflow-runs` ✓live | **required** query: `only_tasks` (bool), `since` (ISO). Optional: `until`, `statuses[]`, `workflow_ids[]`, `worker_id`, `additional_metadata[]`, `limit`, `offset`, `include_payloads`, `parent_task_external_id`, `triggering_event_external_id`. Returns `{pagination, rows[]}` |
| `get_run` | `GET /api/v1/stable/workflow-runs/{externalId}` ✓live | returns `{run, shape, taskEvents, tasks, workflowConfig}` — consolidated, no extra calls needed |
| `get_run_logs` | `GET /api/v1/stable/tasks/{externalId}/logs` ✓live | query: `limit, since, until, search, levels[], attempt`. Returns `{pagination, rows[]}` (`message, level, createdAt, attempt, taskDisplayName, taskExternalId`) |
| `list_workers` | `GET /api/v1/tenants/{t}/worker` ✓live | |
| `get_queue_metrics` | `GET /api/v1/stable/tenants/{t}/task-metrics` ✓live | replaces deprecated `queue-metrics`; returns a list |
| `trigger_workflow` | `POST /api/v1/stable/tenants/{t}/workflow-runs` | body `V1TriggerWorkflowRunRequest`: `workflowName`*(string), `input`*(object), `additionalMetadata`?(object), `priority`?(int). Path to confirm-on-first-call. |
| `cancel_runs` | `POST /api/v1/stable/tenants/{t}/tasks/cancel` | body `V1CancelTaskRequest`: `externalIds`?(uuid[]), `filter`?(`V1TaskFilter`) |
| `replay_runs` | `POST /api/v1/stable/tenants/{t}/tasks/replay` | body `V1ReplayTaskRequest`: same shape as cancel |

`V1TaskFilter`: `since`*(ISO), `until`?, `statuses`?(enum[]), `workflowIds`?(uuid[]), `additionalMetadata`?(string[]).

**`list_events` dropped from v1:** legacy `/events` is deprecated and no stable
replacement was confirmed live. Event observability deferred. Tool count is now
11.

## Open Implementation Risks

1. ~~**JWT claim names**~~ — RESOLVED 2026-05-30 against a live Cloud token:
   `server_url` and `sub`. Auth + tenant path verified `200`.
2. **Endpoint shape variance** between Hatchet versions — the OpenAPI spec is
   the source of truth; pin to documented `/api/v1` paths and record fixtures
   from a live instance. List responses use `{pagination, rows}` (confirmed for
   workflows).
3. **`trigger` vs per-workflow trigger** — confirm which trigger endpoint takes
   workflow name vs id and the input body shape during implementation.
4. **`get_run_logs` exact source** — confirm whether step logs come from a
   dedicated logs endpoint or step-run events; record a fixture from a real run.
