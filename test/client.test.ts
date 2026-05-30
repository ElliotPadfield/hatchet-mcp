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
