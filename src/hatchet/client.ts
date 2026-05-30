import type { HatchetConfig } from "./auth.js";
import type {
  Paginated, WorkflowRow, RunRow, RunDetail, LogRow, WorkerRow, ListRunsParams,
} from "./types.js";

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
    const raw = await res.text();
    if (!raw) return undefined as T;
    return JSON.parse(raw) as T;
  }

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
