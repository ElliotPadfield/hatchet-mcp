# Hatchet MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `hatchet-mcp`, a public stdio MCP server (TypeScript, `npx`) that wraps the Hatchet REST API so agents can observe and safely operate Hatchet workflows.

**Architecture:** A transport-agnostic `HatchetClient` (thin typed `fetch` wrapper over the `/api/v1/stable` REST API, Bearer auth) + a set of consolidated MCP tools registered on an `McpServer`. Config is derived from a single `HATCHET_CLIENT_TOKEN` JWT (decoded for `server_url` + `sub`/tenant), with env overrides. `index.ts` is the only stdio-specific file so a remote transport can be added later without rewriting tools.

**Tech Stack:** Node 20+ (global `fetch`), TypeScript (ESM), `@modelcontextprotocol/sdk`, `zod`, `vitest`, `tsup` (bundling), `tsx` (dev run).

**Spec:** `docs/superpowers/specs/2026-05-30-hatchet-mcp-design.md` — see its "Verified API Mapping" table for exact endpoints (all probed live 2026-05-30).

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | deps, scripts, `bin: { "hatchet-mcp": "dist/index.js" }`, ESM (`"type": "module"`) |
| `tsconfig.json` | strict TS, ESNext modules, `dist` out |
| `vitest.config.ts` | test config |
| `src/hatchet/auth.ts` | `decodeToken()`, `resolveConfig()` — token → `{ serverUrl, tenantId, token }` with env overrides |
| `src/hatchet/types.ts` | response/row TypeScript types we surface |
| `src/hatchet/client.ts` | `HatchetClient`: private `request()` + typed read/write methods, HTTP error mapping |
| `src/format.ts` | pure formatters: API JSON → compact text for the model |
| `src/tools/observability.ts` | `registerObservabilityTools(server, client)` |
| `src/tools/actions.ts` | `registerActionTools(server, client)` |
| `src/server.ts` | `createServer(client)`: builds `McpServer`, registers all tools incl. `whoami` |
| `src/index.ts` | stdio bootstrap: `resolveConfig()` → client → `StdioServerTransport` |
| `test/auth.test.ts` | unit tests for auth |
| `test/client.test.ts` | unit tests for client (mocked `fetch`) |
| `test/format.test.ts` | golden tests for formatters |
| `test/fixtures/*.json` | recorded live responses (token scrubbed) |
| `README.md`, `LICENSE` | docs + MIT |

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (placeholder)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "hatchet-mcp",
  "version": "0.1.0",
  "description": "Model Context Protocol server for the Hatchet workflow orchestration API",
  "license": "MIT",
  "type": "module",
  "bin": { "hatchet-mcp": "dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --target node20 --clean --dts=false",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "pnpm build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 4: Placeholder `src/index.ts`**

```ts
// Bootstrap implemented in a later task.
export {};
```

- [ ] **Step 5: Install deps**

Run: `pnpm install`
Expected: completes, creates `node_modules/` and `pnpm-lock.yaml`. `node_modules/` already gitignored.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/index.ts pnpm-lock.yaml
git commit -m "chore: scaffold hatchet-mcp TypeScript project"
```

---

## Task 2: Auth — token decode + config resolution

The Hatchet client token is a JWT. Its payload (base64url, segment 2) contains `server_url` and `sub` (tenant id). Env vars override.

**Files:**
- Create: `src/hatchet/auth.ts`
- Test: `test/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/auth.test.ts
import { describe, it, expect } from "vitest";
import { decodeToken, resolveConfig } from "../src/hatchet/auth.js";

// JWT with payload {"server_url":"https://cloud.onhatchet.run","sub":"tenant-123"}
// header/sig are dummies — we only decode the payload, never verify the signature.
const PAYLOAD = Buffer.from(
  JSON.stringify({ server_url: "https://cloud.onhatchet.run", sub: "tenant-123" }),
).toString("base64url");
const TOKEN = `aaa.${PAYLOAD}.bbb`;

describe("decodeToken", () => {
  it("extracts server_url and sub", () => {
    expect(decodeToken(TOKEN)).toEqual({
      serverUrl: "https://cloud.onhatchet.run",
      tenantId: "tenant-123",
    });
  });

  it("throws on a malformed (non-3-part) token", () => {
    expect(() => decodeToken("not-a-jwt")).toThrow(/malformed/i);
  });
});

describe("resolveConfig", () => {
  it("derives base + tenant from the token", () => {
    expect(resolveConfig({ HATCHET_CLIENT_TOKEN: TOKEN })).toEqual({
      token: TOKEN,
      apiBase: "https://cloud.onhatchet.run",
      tenantId: "tenant-123",
    });
  });

  it("env overrides take precedence over token claims", () => {
    expect(
      resolveConfig({
        HATCHET_CLIENT_TOKEN: TOKEN,
        HATCHET_API_BASE: "https://self.hosted.example",
        HATCHET_TENANT_ID: "tenant-override",
      }),
    ).toEqual({
      token: TOKEN,
      apiBase: "https://self.hosted.example",
      tenantId: "tenant-override",
    });
  });

  it("throws a clear error when token is missing", () => {
    expect(() => resolveConfig({})).toThrow(/HATCHET_CLIENT_TOKEN/);
  });

  it("strips a trailing slash from apiBase", () => {
    expect(
      resolveConfig({ HATCHET_CLIENT_TOKEN: TOKEN, HATCHET_API_BASE: "https://x.example/" }).apiBase,
    ).toBe("https://x.example");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/auth.test.ts`
Expected: FAIL — cannot find module `../src/hatchet/auth.js`.

- [ ] **Step 3: Write `src/hatchet/auth.ts`**

```ts
export interface HatchetConfig {
  token: string;
  apiBase: string;
  tenantId: string;
}

export function decodeToken(token: string): { serverUrl: string; tenantId: string } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed Hatchet token: expected a 3-part JWT.");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed Hatchet token: payload is not valid JSON.");
  }
  return {
    serverUrl: typeof payload.server_url === "string" ? payload.server_url : "",
    tenantId: typeof payload.sub === "string" ? payload.sub : "",
  };
}

export function resolveConfig(env: Record<string, string | undefined>): HatchetConfig {
  const token = env.HATCHET_CLIENT_TOKEN;
  if (!token) {
    throw new Error("HATCHET_CLIENT_TOKEN is required. Generate an API token in the Hatchet dashboard.");
  }
  const claims = decodeToken(token);
  const apiBase = (env.HATCHET_API_BASE || claims.serverUrl).replace(/\/+$/, "");
  const tenantId = env.HATCHET_TENANT_ID || claims.tenantId;
  if (!apiBase) {
    throw new Error("Could not determine API base URL. Set HATCHET_API_BASE.");
  }
  if (!tenantId) {
    throw new Error("Could not determine tenant id from token. Set HATCHET_TENANT_ID.");
  }
  return { token, apiBase, tenantId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hatchet/auth.ts test/auth.test.ts
git commit -m "feat: token decode + config resolution with env overrides"
```

---

## Task 3: HatchetClient core — `request()` + error mapping

**Files:**
- Create: `src/hatchet/client.ts`
- Test: `test/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { HatchetClient, HatchetApiError } from "../src/hatchet/client.js";

const cfg = { token: "tok-secret", apiBase: "https://api.example", tenantId: "t1" };

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("HatchetClient.request", () => {
  it("sends the Bearer header and parses JSON", async () => {
    const f = mockFetch(200, { ok: true });
    const client = new HatchetClient(cfg, f);
    const res = await client.request("GET", "/api/v1/ping");
    expect(res).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.example/api/v1/ping");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-secret");
  });

  it("serializes query params, dropping undefined", async () => {
    const f = mockFetch(200, {});
    const client = new HatchetClient(cfg, f);
    await client.request("GET", "/x", { query: { a: "1", b: undefined, list: ["p", "q"] } });
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain("a=1");
    expect(url).not.toContain("b=");
    expect(url).toContain("list=p");
    expect(url).toContain("list=q");
  });

  it("sends a JSON body for writes", async () => {
    const f = mockFetch(200, {});
    const client = new HatchetClient(cfg, f);
    await client.request("POST", "/x", { body: { hello: "world" } });
    const init = f.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ hello: "world" }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("maps 401 to a clear error", async () => {
    const client = new HatchetClient(cfg, mockFetch(401, { message: "nope" }));
    await expect(client.request("GET", "/x")).rejects.toThrow(/invalid or expired/i);
  });

  it("maps 404 to a tenant-aware error", async () => {
    const client = new HatchetClient(cfg, mockFetch(404, {}));
    await expect(client.request("GET", "/x")).rejects.toThrow(/not found/i);
  });

  it("never includes the token in error messages", async () => {
    const client = new HatchetClient(cfg, mockFetch(500, { message: "boom" }));
    await expect(client.request("GET", "/x")).rejects.toThrow(HatchetApiError);
    await client.request("GET", "/x").catch((e: Error) => {
      expect(e.message).not.toContain("tok-secret");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/client.test.ts`
Expected: FAIL — cannot find module `../src/hatchet/client.js`.

- [ ] **Step 3: Write `src/hatchet/client.ts` (core only; typed methods added next task)**

```ts
import type { HatchetConfig } from "./auth.js";

export class HatchetApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HatchetApiError";
  }
}

type FetchLike = typeof fetch;

export interface RequestOpts {
  query?: Record<string, string | string[] | number | boolean | undefined>;
  body?: unknown;
}

export class HatchetClient {
  constructor(
    private cfg: HatchetConfig,
    private fetchImpl: FetchLike = fetch,
  ) {}

  get tenantId(): string {
    return this.cfg.tenantId;
  }
  get apiBase(): string {
    return this.cfg.apiBase;
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    const url = new URL(this.cfg.apiBase + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
      else url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.token}`,
      accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), init);
    } catch {
      throw new HatchetApiError(0, `Could not reach Hatchet at ${this.cfg.apiBase}.`);
    }

    if (!res.ok) throw this.toError(res, await res.text());
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private toError(res: Response, body: string): HatchetApiError {
    const trimmed = body.slice(0, 300);
    switch (res.status) {
      case 401:
        return new HatchetApiError(401, "Hatchet token is invalid or expired.");
      case 403:
        return new HatchetApiError(403, "Token lacks permission for this tenant or resource.");
      case 404:
        return new HatchetApiError(
          404,
          "Not found — check the id and that the tenant matches the token's tenant.",
        );
      case 429: {
        const retry = res.headers.get("retry-after");
        return new HatchetApiError(429, `Rate limited by Hatchet${retry ? `; retry after ${retry}s` : ""}.`);
      }
      default:
        return new HatchetApiError(res.status, `Hatchet API error (HTTP ${res.status}). ${trimmed}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hatchet/client.ts test/client.test.ts
git commit -m "feat: HatchetClient request layer with HTTP error mapping"
```

---

## Task 4: Types + client read methods

Endpoints below are verified live (see spec mapping). All list responses are `{ pagination, rows }`.

**Files:**
- Create: `src/hatchet/types.ts`
- Modify: `src/hatchet/client.ts` (add read methods)
- Modify: `test/client.test.ts` (add read-method tests)

- [ ] **Step 1: Write `src/hatchet/types.ts`**

```ts
export interface Paginated<T> {
  pagination?: { current_page?: number; next_page?: number; num_pages?: number };
  rows: T[];
}

export interface ApiMeta {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowRow {
  metadata: ApiMeta;
  name: string;
  description?: string;
}

// A row from /stable/tenants/{t}/workflow-runs (verified shape).
export interface RunRow {
  metadata: ApiMeta;
  displayName: string;
  status: string;
  workflowName: string;
  workflowId: string;
  taskExternalId: string;
  workflowRunExternalId: string;
  errorMessage?: string;
  createdAt: string;
  type?: string;
  additionalMetadata?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
}

// /stable/workflow-runs/{id} consolidated detail.
export interface RunDetail {
  run: RunRow;
  shape?: unknown;
  tasks?: RunRow[];
  taskEvents?: unknown[];
  workflowConfig?: unknown;
}

export interface LogRow {
  message: string;
  level: string;
  createdAt: string;
  attempt?: number;
  taskDisplayName?: string;
  taskExternalId?: string;
}

export interface WorkerRow {
  metadata?: ApiMeta;
  name?: string;
  status?: string;
  lastHeartbeatAt?: string;
}

export interface ListRunsParams {
  since: string; // required by the API
  onlyTasks?: boolean; // maps to only_tasks (default false)
  until?: string;
  statuses?: string[];
  workflowIds?: string[];
  limit?: number;
  offset?: number;
  includePayloads?: boolean;
  additionalMetadata?: string[];
}
```

- [ ] **Step 2: Write failing tests for read methods (append to `test/client.test.ts`)**

```ts
describe("HatchetClient read methods", () => {
  it("listWorkflows hits the tenant workflows path", async () => {
    const f = mockFetch(200, { rows: [{ metadata: { id: "w1" }, name: "wf" }] });
    const client = new HatchetClient(cfg, f);
    const res = await client.listWorkflows({ limit: 5 });
    expect(client_calledPath(f)).toBe("/api/v1/tenants/t1/workflows");
    expect(res.rows[0].name).toBe("wf");
  });

  it("listRuns sends required only_tasks and since", async () => {
    const f = mockFetch(200, { rows: [] });
    const client = new HatchetClient(cfg, f);
    await client.listRuns({ since: "2026-05-20T00:00:00.000Z" });
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/stable/tenants/t1/workflow-runs");
    expect(url).toContain("only_tasks=false");
    expect(url).toContain("since=2026-05-20");
  });

  it("getRun fetches the consolidated stable detail", async () => {
    const f = mockFetch(200, { run: { metadata: { id: "r1" }, status: "RUNNING" } });
    const client = new HatchetClient(cfg, f);
    await client.getRun("r1");
    expect(client_calledPath(f)).toBe("/api/v1/stable/workflow-runs/r1");
  });

  it("getTaskLogs hits the stable task logs path", async () => {
    const f = mockFetch(200, { rows: [] });
    const client = new HatchetClient(cfg, f);
    await client.getTaskLogs("task-1", { limit: 50 });
    expect(client_calledPath(f)).toBe("/api/v1/stable/tasks/task-1/logs");
  });

  it("listWorkers hits the worker path", async () => {
    const f = mockFetch(200, { rows: [] });
    const client = new HatchetClient(cfg, f);
    await client.listWorkers();
    expect(client_calledPath(f)).toBe("/api/v1/tenants/t1/worker");
  });

  it("getTaskMetrics hits the stable task-metrics path", async () => {
    const f = mockFetch(200, []);
    const client = new HatchetClient(cfg, f);
    await client.getTaskMetrics();
    expect(client_calledPath(f)).toBe("/api/v1/stable/tenants/t1/task-metrics");
  });
});

// Helper: extract pathname from the first fetch call.
function client_calledPath(f: ReturnType<typeof vi.fn>): string {
  return new URL(f.mock.calls[0][0] as string).pathname;
}
```

(Add `import` of `vi` is already present at top of file.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run test/client.test.ts`
Expected: FAIL — `client.listWorkflows is not a function`.

- [ ] **Step 4: Add read methods to `src/hatchet/client.ts`**

Add these imports at the top:

```ts
import type {
  Paginated, WorkflowRow, RunRow, RunDetail, LogRow, WorkerRow, ListRunsParams,
} from "./types.js";
```

Add inside the `HatchetClient` class:

```ts
  listWorkflows(params: { limit?: number; offset?: number } = {}): Promise<Paginated<WorkflowRow>> {
    return this.request("GET", `/api/v1/tenants/${this.cfg.tenantId}/workflows`, {
      query: { limit: params.limit, offset: params.offset },
    });
  }

  listRuns(params: ListRunsParams): Promise<Paginated<RunRow>> {
    return this.request("GET", `/api/v1/stable/tenants/${this.cfg.tenantId}/workflow-runs`, {
      query: {
        only_tasks: params.onlyTasks ?? false,
        since: params.since,
        until: params.until,
        statuses: params.statuses,
        workflow_ids: params.workflowIds,
        additional_metadata: params.additionalMetadata,
        limit: params.limit,
        offset: params.offset,
        include_payloads: params.includePayloads,
      },
    });
  }

  getRun(externalId: string): Promise<RunDetail> {
    return this.request("GET", `/api/v1/stable/workflow-runs/${externalId}`);
  }

  getTaskLogs(
    taskExternalId: string,
    params: { limit?: number; since?: string; until?: string; search?: string; levels?: string[]; attempt?: number } = {},
  ): Promise<Paginated<LogRow>> {
    return this.request("GET", `/api/v1/stable/tasks/${taskExternalId}/logs`, {
      query: {
        limit: params.limit,
        since: params.since,
        until: params.until,
        search: params.search,
        levels: params.levels,
        attempt: params.attempt,
      },
    });
  }

  listWorkers(): Promise<Paginated<WorkerRow>> {
    return this.request("GET", `/api/v1/tenants/${this.cfg.tenantId}/worker`);
  }

  getTaskMetrics(): Promise<unknown> {
    return this.request("GET", `/api/v1/stable/tenants/${this.cfg.tenantId}/task-metrics`);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run test/client.test.ts`
Expected: PASS (all client tests).

- [ ] **Step 6: Commit**

```bash
git add src/hatchet/types.ts src/hatchet/client.ts test/client.test.ts
git commit -m "feat: client read methods (workflows, runs, run detail, logs, workers, metrics)"
```

---

## Task 5: Client write methods (trigger / cancel / replay)

Bodies verified from the OpenAPI contract: `V1TriggerWorkflowRunRequest { workflowName, input, additionalMetadata?, priority? }`; cancel/replay take `{ externalIds?, filter? }`.

**Files:**
- Modify: `src/hatchet/client.ts`
- Modify: `test/client.test.ts`

- [ ] **Step 1: Write failing tests (append to `test/client.test.ts`)**

```ts
describe("HatchetClient write methods", () => {
  it("triggerWorkflow posts workflowName + input", async () => {
    const f = mockFetch(200, { run: { metadata: { id: "r9" } } });
    const client = new HatchetClient(cfg, f);
    await client.triggerWorkflow({ workflowName: "my-wf", input: { x: 1 } });
    const [url, init] = f.mock.calls[0];
    expect(new URL(url as string).pathname).toBe("/api/v1/stable/tenants/t1/workflow-runs");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      workflowName: "my-wf",
      input: { x: 1 },
    });
  });

  it("cancelRuns posts externalIds to the tasks/cancel path", async () => {
    const f = mockFetch(200, {});
    const client = new HatchetClient(cfg, f);
    await client.cancelRuns(["a", "b"]);
    const [url, init] = f.mock.calls[0];
    expect(new URL(url as string).pathname).toBe("/api/v1/stable/tenants/t1/tasks/cancel");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ externalIds: ["a", "b"] });
  });

  it("replayRuns posts externalIds to the tasks/replay path", async () => {
    const f = mockFetch(200, {});
    const client = new HatchetClient(cfg, f);
    await client.replayRuns(["a"]);
    expect(new URL(f.mock.calls[0][0] as string).pathname).toBe("/api/v1/stable/tenants/t1/tasks/replay");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/client.test.ts`
Expected: FAIL — `client.triggerWorkflow is not a function`.

- [ ] **Step 3: Add write methods to `src/hatchet/client.ts`**

```ts
  triggerWorkflow(args: {
    workflowName: string;
    input: Record<string, unknown>;
    additionalMetadata?: Record<string, unknown>;
    priority?: number;
  }): Promise<unknown> {
    return this.request("POST", `/api/v1/stable/tenants/${this.cfg.tenantId}/workflow-runs`, {
      body: {
        workflowName: args.workflowName,
        input: args.input,
        additionalMetadata: args.additionalMetadata,
        priority: args.priority,
      },
    });
  }

  cancelRuns(externalIds: string[]): Promise<unknown> {
    return this.request("POST", `/api/v1/stable/tenants/${this.cfg.tenantId}/tasks/cancel`, {
      body: { externalIds },
    });
  }

  replayRuns(externalIds: string[]): Promise<unknown> {
    return this.request("POST", `/api/v1/stable/tenants/${this.cfg.tenantId}/tasks/replay`, {
      body: { externalIds },
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hatchet/client.ts test/client.test.ts
git commit -m "feat: client write methods (trigger, cancel, replay)"
```

---

## Task 6: Formatters (compact, token-efficient output)

Pure functions: API shapes → compact strings. Fixtures below are scrubbed copies of real responses.

**Files:**
- Create: `test/fixtures/runs.json`, `test/fixtures/run-detail.json`, `test/fixtures/logs.json`
- Create: `src/format.ts`
- Test: `test/format.test.ts`

- [ ] **Step 1: Write fixtures**

`test/fixtures/runs.json`:

```json
{
  "pagination": { "current_page": 0, "num_pages": 1 },
  "rows": [
    {
      "metadata": { "id": "e6150bc5-086e-4751-b1ba-a800bb48ff9b", "createdAt": "2026-05-30T19:50:00.505728Z" },
      "displayName": "transcribe-batch-mlx-1780170600529",
      "status": "QUEUED",
      "workflowName": "transcribe-batch-mlx",
      "workflowId": "b0440966-2fab-4acd-a7f7-3226c6a0962f",
      "taskExternalId": "e6150bc5-086e-4751-b1ba-a800bb48ff9b",
      "workflowRunExternalId": "e6150bc5-086e-4751-b1ba-a800bb48ff9b",
      "errorMessage": "",
      "createdAt": "2026-05-30T19:50:00.505728Z",
      "type": "DAG"
    }
  ]
}
```

`test/fixtures/run-detail.json`:

```json
{
  "run": {
    "metadata": { "id": "e6150bc5-086e-4751-b1ba-a800bb48ff9b" },
    "displayName": "transcribe-batch-mlx-1780170600529",
    "status": "FAILED",
    "workflowName": "transcribe-batch-mlx",
    "workflowId": "b0440966",
    "taskExternalId": "e6150bc5-086e-4751-b1ba-a800bb48ff9b",
    "workflowRunExternalId": "e6150bc5-086e-4751-b1ba-a800bb48ff9b",
    "errorMessage": "boom",
    "createdAt": "2026-05-30T19:50:00.505728Z"
  },
  "tasks": [
    {
      "metadata": { "id": "task-1" },
      "displayName": "step-a",
      "status": "FAILED",
      "workflowName": "transcribe-batch-mlx",
      "workflowId": "b0440966",
      "taskExternalId": "task-1",
      "workflowRunExternalId": "e6150bc5",
      "errorMessage": "boom",
      "createdAt": "2026-05-30T19:50:00Z"
    }
  ]
}
```

`test/fixtures/logs.json`:

```json
{
  "pagination": { "current_page": 0 },
  "rows": [
    { "message": "Polling for pending refresh requests", "level": "INFO", "createdAt": "2026-05-23T19:55:03.088Z", "attempt": 1, "taskDisplayName": "refresh-request-poller", "taskExternalId": "6e72aa40" },
    { "message": "No pending refresh requests", "level": "INFO", "createdAt": "2026-05-23T19:55:05.351Z", "attempt": 1, "taskDisplayName": "refresh-request-poller", "taskExternalId": "6e72aa40" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// test/format.test.ts
import { describe, it, expect } from "vitest";
import { formatRunsList, formatRunDetail, formatLogs } from "../src/format.js";
import runs from "./fixtures/runs.json" with { type: "json" };
import runDetail from "./fixtures/run-detail.json" with { type: "json" };
import logs from "./fixtures/logs.json" with { type: "json" };

describe("formatRunsList", () => {
  it("renders one compact line per run with id, status, name", () => {
    const out = formatRunsList(runs as any);
    expect(out).toContain("transcribe-batch-mlx");
    expect(out).toContain("QUEUED");
    expect(out).toContain("e6150bc5-086e-4751-b1ba-a800bb48ff9b");
  });

  it("reports an empty result clearly", () => {
    expect(formatRunsList({ rows: [] } as any)).toMatch(/no runs/i);
  });
});

describe("formatRunDetail", () => {
  it("summarizes run status and per-task status + error", () => {
    const out = formatRunDetail(runDetail as any);
    expect(out).toContain("FAILED");
    expect(out).toContain("step-a");
    expect(out).toContain("boom");
  });
});

describe("formatLogs", () => {
  it("renders level + message per line", () => {
    const out = formatLogs(logs as any);
    expect(out).toContain("INFO");
    expect(out).toContain("No pending refresh requests");
  });

  it("reports empty logs clearly", () => {
    expect(formatLogs({ rows: [] } as any)).toMatch(/no logs/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run test/format.test.ts`
Expected: FAIL — cannot find module `../src/format.js`.

- [ ] **Step 4: Write `src/format.ts`**

```ts
import type { Paginated, RunRow, RunDetail, LogRow } from "./hatchet/types.js";

export function formatRunsList(res: Paginated<RunRow>): string {
  if (!res.rows?.length) return "No runs found in the requested window.";
  const lines = res.rows.map((r) => {
    const id = r.metadata?.id ?? r.workflowRunExternalId;
    const err = r.errorMessage ? ` — ${r.errorMessage}` : "";
    return `[${r.status}] ${r.workflowName} (${r.displayName}) id=${id} at ${r.createdAt}${err}`;
  });
  return `${res.rows.length} run(s):\n${lines.join("\n")}`;
}

export function formatRunDetail(res: RunDetail): string {
  const run = res.run;
  const head = `Run ${run.displayName} [${run.status}] workflow=${run.workflowName} id=${run.metadata?.id ?? run.workflowRunExternalId}`;
  const err = run.errorMessage ? `\nerror: ${run.errorMessage}` : "";
  const tasks = (res.tasks ?? [])
    .map((t) => {
      const te = t.errorMessage ? ` — ${t.errorMessage}` : "";
      return `  • ${t.displayName} [${t.status}] id=${t.taskExternalId}${te}`;
    })
    .join("\n");
  const taskBlock = tasks ? `\ntasks:\n${tasks}` : "";
  return `${head}${err}${taskBlock}`;
}

export function formatLogs(res: Paginated<LogRow>): string {
  if (!res.rows?.length) return "No logs for this task.";
  return res.rows.map((l) => `${l.createdAt} [${l.level}] ${l.message}`).join("\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run test/format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/format.ts test/format.test.ts test/fixtures
git commit -m "feat: compact output formatters with golden fixtures"
```

---

## Task 7: Observability tools

Register read tools on the MCP server. Each tool: a `zod` schema, calls the client, returns formatted text. For shapes without a dedicated formatter (workers, metrics, workflows), return pretty JSON trimmed.

**Files:**
- Create: `src/tools/observability.ts`
- Test: `test/tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/tools.test.ts
import { describe, it, expect, vi } from "vitest";
import { registerObservabilityTools } from "../src/tools/observability.js";

// Minimal fake server that records registered tools and lets us invoke them.
function fakeServer() {
  const tools: Record<string, { schema: unknown; handler: (a: any) => Promise<any> }> = {};
  return {
    tools,
    registerTool(name: string, def: { inputSchema?: unknown }, handler: (a: any) => Promise<any>) {
      tools[name] = { schema: def.inputSchema, handler };
    },
  };
}

const fakeClient = {
  tenantId: "t1",
  listWorkflows: vi.fn(async () => ({ rows: [{ metadata: { id: "w1" }, name: "wf" }] })),
  listRuns: vi.fn(async () => ({ rows: [] })),
  getRun: vi.fn(async () => ({ run: { metadata: { id: "r1" }, displayName: "d", status: "RUNNING", workflowName: "wf" } })),
  getTaskLogs: vi.fn(async () => ({ rows: [] })),
  listWorkers: vi.fn(async () => ({ rows: [] })),
  getTaskMetrics: vi.fn(async () => []),
};

describe("registerObservabilityTools", () => {
  it("registers the expected read tools", () => {
    const s = fakeServer();
    registerObservabilityTools(s as any, fakeClient as any);
    for (const name of ["list_workflows", "list_runs", "get_run", "get_run_logs", "list_workers", "get_queue_metrics"]) {
      expect(s.tools[name]).toBeDefined();
    }
  });

  it("list_runs defaults 'since' when omitted and returns text content", async () => {
    const s = fakeServer();
    registerObservabilityTools(s as any, fakeClient as any);
    const res = await s.tools["list_runs"].handler({});
    expect(fakeClient.listRuns).toHaveBeenCalled();
    const arg = (fakeClient.listRuns as any).mock.calls.at(-1)[0];
    expect(arg.since).toBeTruthy(); // a default ISO timestamp was supplied
    expect(res.content[0].type).toBe("text");
  });

  it("get_run passes the run id through", async () => {
    const s = fakeServer();
    registerObservabilityTools(s as any, fakeClient as any);
    await s.tools["get_run"].handler({ runId: "r1" });
    expect(fakeClient.getRun).toHaveBeenCalledWith("r1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/tools.test.ts`
Expected: FAIL — cannot find module `../src/tools/observability.js`.

- [ ] **Step 3: Write `src/tools/observability.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HatchetClient } from "../hatchet/client.js";
import { formatRunsList, formatRunDetail, formatLogs } from "../format.js";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (v: unknown) => text("```json\n" + JSON.stringify(v, null, 2).slice(0, 8000) + "\n```");

// Default lookback window for list_runs when the caller omits `since`.
function defaultSince(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export function registerObservabilityTools(server: McpServer, client: HatchetClient): void {
  server.registerTool(
    "list_workflows",
    {
      description: "List workflow definitions for the tenant.",
      inputSchema: { limit: z.number().int().positive().max(200).optional() },
    },
    async ({ limit }) => json(await client.listWorkflows({ limit })),
  );

  server.registerTool(
    "list_runs",
    {
      description:
        "List recent workflow/task runs. Filters: status, workflow ids, time window. Defaults to the last 24h if 'since' is omitted.",
      inputSchema: {
        since: z.string().optional().describe("ISO timestamp lower bound; defaults to 24h ago"),
        until: z.string().optional(),
        statuses: z.array(z.string()).optional().describe("e.g. QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED"),
        workflowIds: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) =>
      text(
        formatRunsList(
          await client.listRuns({
            since: args.since ?? defaultSince(),
            until: args.until,
            statuses: args.statuses,
            workflowIds: args.workflowIds,
            limit: args.limit ?? 50,
          }),
        ),
      ),
  );

  server.registerTool(
    "get_run",
    {
      description: "Get the full detail of one workflow run (status, tasks, errors) by its external id.",
      inputSchema: { runId: z.string().describe("workflowRunExternalId / taskExternalId") },
    },
    async ({ runId }) => text(formatRunDetail(await client.getRun(runId))),
  );

  server.registerTool(
    "get_run_logs",
    {
      description: "Get log lines for a task by its external id.",
      inputSchema: {
        taskId: z.string().describe("taskExternalId"),
        limit: z.number().int().positive().max(500).optional(),
        search: z.string().optional(),
        levels: z.array(z.string()).optional().describe("e.g. INFO, WARN, ERROR"),
      },
    },
    async ({ taskId, limit, search, levels }) =>
      text(formatLogs(await client.getTaskLogs(taskId, { limit: limit ?? 100, search, levels }))),
  );

  server.registerTool(
    "list_workers",
    { description: "List workers and their status.", inputSchema: {} },
    async () => json(await client.listWorkers()),
  );

  server.registerTool(
    "get_queue_metrics",
    { description: "Get task/queue metrics for the tenant (queue health).", inputSchema: {} },
    async () => json(await client.getTaskMetrics()),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/tools.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/observability.ts test/tools.test.ts
git commit -m "feat: observability MCP tools"
```

---

## Task 8: Action tools (safe writes)

**Files:**
- Create: `src/tools/actions.ts`
- Modify: `test/tools.test.ts`

- [ ] **Step 1: Write failing tests (append to `test/tools.test.ts`)**

```ts
import { registerActionTools } from "../src/tools/actions.js";

const actionClient = {
  tenantId: "t1",
  triggerWorkflow: vi.fn(async () => ({ run: { metadata: { id: "r9" } } })),
  cancelRuns: vi.fn(async () => ({})),
  replayRuns: vi.fn(async () => ({})),
};

describe("registerActionTools", () => {
  it("registers trigger/cancel/replay", () => {
    const s = fakeServer();
    registerActionTools(s as any, actionClient as any);
    for (const n of ["trigger_workflow", "cancel_runs", "replay_runs"]) {
      expect(s.tools[n]).toBeDefined();
    }
  });

  it("trigger_workflow forwards name + input", async () => {
    const s = fakeServer();
    registerActionTools(s as any, actionClient as any);
    await s.tools["trigger_workflow"].handler({ workflowName: "wf", input: { a: 1 } });
    expect(actionClient.triggerWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: "wf", input: { a: 1 } }),
    );
  });

  it("cancel_runs forwards the id list", async () => {
    const s = fakeServer();
    registerActionTools(s as any, actionClient as any);
    await s.tools["cancel_runs"].handler({ runIds: ["a", "b"] });
    expect(actionClient.cancelRuns).toHaveBeenCalledWith(["a", "b"]);
  });
});
```

(Note: `fakeServer` is already defined at the top of this test file from Task 7.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/tools.test.ts`
Expected: FAIL — cannot find module `../src/tools/actions.js`.

- [ ] **Step 3: Write `src/tools/actions.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HatchetClient } from "../hatchet/client.js";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

export function registerActionTools(server: McpServer, client: HatchetClient): void {
  server.registerTool(
    "trigger_workflow",
    {
      description:
        "MUTATES LIVE STATE. Trigger a new workflow run by name with a JSON input payload.",
      inputSchema: {
        workflowName: z.string(),
        input: z.record(z.unknown()).default({}),
        additionalMetadata: z.record(z.unknown()).optional(),
        priority: z.number().int().min(1).max(3).optional(),
      },
    },
    async (args) => {
      const res = await client.triggerWorkflow({
        workflowName: args.workflowName,
        input: args.input ?? {},
        additionalMetadata: args.additionalMetadata,
        priority: args.priority,
      });
      return text("Triggered.\n```json\n" + JSON.stringify(res, null, 2).slice(0, 2000) + "\n```");
    },
  );

  server.registerTool(
    "cancel_runs",
    {
      description: "MUTATES LIVE STATE. Cancel one or more runs/tasks by external id.",
      inputSchema: { runIds: z.array(z.string()).min(1) },
    },
    async ({ runIds }) => {
      await client.cancelRuns(runIds);
      return text(`Cancelled ${runIds.length} run(s).`);
    },
  );

  server.registerTool(
    "replay_runs",
    {
      description: "MUTATES LIVE STATE. Replay/retry one or more runs/tasks by external id.",
      inputSchema: { runIds: z.array(z.string()).min(1) },
    },
    async ({ runIds }) => {
      await client.replayRuns(runIds);
      return text(`Replayed ${runIds.length} run(s).`);
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/actions.ts test/tools.test.ts
git commit -m "feat: action MCP tools (trigger, cancel, replay)"
```

---

## Task 9: Server assembly + `whoami`

**Files:**
- Create: `src/server.ts`
- Modify: `test/tools.test.ts` (or new `test/server.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// test/server.test.ts
import { describe, it, expect, vi } from "vitest";
import { createServer } from "../src/server.js";

const client = {
  tenantId: "t1",
  apiBase: "https://api.example",
  listWorkflows: vi.fn(async () => ({ rows: [{ metadata: { id: "w1" }, name: "wf" }] })),
  listRuns: vi.fn(async () => ({ rows: [] })),
  getRun: vi.fn(),
  getTaskLogs: vi.fn(),
  listWorkers: vi.fn(),
  getTaskMetrics: vi.fn(),
  triggerWorkflow: vi.fn(),
  cancelRuns: vi.fn(),
  replayRuns: vi.fn(),
};

describe("createServer", () => {
  it("returns an McpServer instance without throwing", () => {
    const server = createServer(client as any);
    expect(server).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/server.test.ts`
Expected: FAIL — cannot find module `../src/server.js`.

- [ ] **Step 3: Write `src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HatchetClient } from "./hatchet/client.js";
import { registerObservabilityTools } from "./tools/observability.js";
import { registerActionTools } from "./tools/actions.js";

export function createServer(client: HatchetClient): McpServer {
  const server = new McpServer({ name: "hatchet-mcp", version: "0.1.0" });

  server.registerTool(
    "whoami",
    {
      description: "Show the resolved Hatchet tenant + server URL and confirm the token works.",
      inputSchema: {},
    },
    async () => {
      let live = "unknown";
      try {
        await client.listWorkflows({ limit: 1 });
        live = "ok";
      } catch (e) {
        live = `failed: ${(e as Error).message}`;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `tenant: ${client.tenantId}\nserver: ${client.apiBase}\nliveness: ${live}`,
          },
        ],
      };
    },
  );

  registerObservabilityTools(server, client);
  registerActionTools(server, client);
  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: ALL tests pass (auth, client, format, tools, server).

- [ ] **Step 6: Commit**

```bash
git add src/server.ts test/server.test.ts
git commit -m "feat: assemble McpServer with whoami + all tools"
```

---

## Task 10: stdio bootstrap (`index.ts`)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/index.ts`**

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig } from "./hatchet/auth.js";
import { HatchetClient } from "./hatchet/client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = resolveConfig(process.env);
  } catch (e) {
    // stderr only — stdout is the JSON-RPC channel.
    process.stderr.write(`hatchet-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  }
  const client = new HatchetClient(config);
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`hatchet-mcp connected (tenant ${config.tenantId} @ ${config.apiBase})\n`);
}

main().catch((e) => {
  process.stderr.write(`hatchet-mcp fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build`
Expected: PASS — produces `dist/index.js` with a shebang.

- [ ] **Step 3: Smoke-test startup failure path (no token)**

Run: `node dist/index.js < /dev/null`
Expected: prints `hatchet-mcp: HATCHET_CLIENT_TOKEN is required...` to stderr and exits 1.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: stdio bootstrap entrypoint"
```

---

## Task 11: Live verification + remaining-unknown checks

This is the manual gate that confirms the two contract-derived endpoints (`trigger` path, write bodies) behave on a real instance, and that the read tools work end-to-end. Requires a real `HATCHET_CLIENT_TOKEN`.

- [ ] **Step 1: Build and create a local run config**

Run: `pnpm build`
Create `.env` (already gitignored) with `HATCHET_CLIENT_TOKEN=...`.

- [ ] **Step 2: Drive the server with the MCP Inspector**

Run: `pnpm dlx @modelcontextprotocol/inspector node dist/index.js`
(Pass the token via the Inspector's env settings, or `export $(cat .env)` first.)
Expected: Inspector connects; the Tools tab lists `whoami`, `list_workflows`, `list_runs`, `get_run`, `get_run_logs`, `list_workers`, `get_queue_metrics`, `trigger_workflow`, `cancel_runs`, `replay_runs`.

- [ ] **Step 3: Exercise read tools**

In the Inspector, call in order:
1. `whoami` → expect `liveness: ok`, correct tenant + server.
2. `list_workflows` → expect the tenant's workflows (e.g. `discovery-batch`, `transcribe-batch-mlx`).
3. `list_runs` (no args) → expect recent runs from the last 24h.
4. `get_run` with a `runId` from step 3 → expect status + tasks.
5. `get_run_logs` with that run's `taskExternalId` → expect log lines (or "No logs").

Expected: each returns formatted text, no errors.

- [ ] **Step 4: Verify the trigger path (the one contract-only endpoint)**

Pick a safe/idempotent workflow name from step 2. Call `trigger_workflow` with `{ workflowName, input: {} }`.
- If it returns "Triggered." with a run id → **path confirmed**. Done.
- If it returns a 404/405 error → the trigger path differs. Fix `triggerWorkflow` in `src/hatchet/client.ts` to `POST /api/v1/tenants/{tenant}/workflows/{workflow}/trigger` (the per-workflow legacy trigger), re-build, retry. Update the spec mapping note accordingly.

- [ ] **Step 5: Record the outcome**

If any endpoint needed correction, update `docs/superpowers/specs/2026-05-30-hatchet-mcp-design.md` "Verified API Mapping" row and re-run `pnpm test`.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: confirm/correct trigger endpoint against live instance"
```

---

## Task 12: Packaging, README, license, release

**Files:**
- Create: `README.md`, `LICENSE`

- [ ] **Step 1: Write `LICENSE`** — standard MIT, copyright "Elliot Padfield".

- [ ] **Step 2: Write `README.md`**

Must include:
- One-line description + the tool list table.
- Install/usage block for Claude Code:

````markdown
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
````

- Self-hosted note: set `HATCHET_API_BASE` and/or `HATCHET_TENANT_ID` to override the values decoded from the token.
- A "Safety" section: read tools are non-destructive; `trigger_workflow`/`cancel_runs`/`replay_runs` mutate live state.
- Token security note: the token grants tenant access; treat it as a secret.

- [ ] **Step 3: Verify the package contents**

Run: `pnpm pack`
Expected: tarball includes `dist/`, `README.md`, `LICENSE`, `package.json` — and NOT `src/`, `test/`, `.env`, `node_modules/`.

- [ ] **Step 4: Final full verification**

Run: `pnpm test && pnpm build`
Expected: all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: README + MIT license; ready for npm publish"
```

- [ ] **Step 6: Publish (human-gated)**

Run (only when the user approves): `pnpm publish --access public`
Expected: `hatchet-mcp@0.1.0` published. (Requires `pnpm login` / npm auth.)

---

## Self-Review Notes

- **Spec coverage:** architecture (Tasks 1,9,10), auth/config (Task 2), client + all 11 verified endpoints (Tasks 3–5), error handling (Task 3), output shaping (Task 6), all tools incl. `whoami` (Tasks 7–9), testing strategy unit + gated live (Tasks 2–9, 11), release/packaging (Task 12). `list_events` intentionally dropped per spec.
- **Type consistency:** `RunRow`/`RunDetail`/`LogRow`/`Paginated` defined in Task 4 are the types consumed by formatters (Task 6) and client methods (Tasks 4–5). Client method names (`listWorkflows`, `listRuns`, `getRun`, `getTaskLogs`, `listWorkers`, `getTaskMetrics`, `triggerWorkflow`, `cancelRuns`, `replayRuns`) are used identically in tools (Tasks 7–8) and server (Task 9).
- **Known live-verify items:** the `trigger_workflow` POST path is contract-derived, not yet live-confirmed (legacy per-workflow trigger is the documented fallback) — Task 11 Step 4 resolves it. Cancel/replay paths and all read paths are live-verified.
