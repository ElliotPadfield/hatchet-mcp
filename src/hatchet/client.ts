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
    const raw = await res.text();
    if (!raw) return undefined as T;
    return JSON.parse(raw) as T;
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
