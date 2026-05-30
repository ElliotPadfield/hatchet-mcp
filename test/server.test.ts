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

  it("registers all 10 tools (whoami + 6 read + 3 write)", () => {
    const server = createServer(client as any) as any;
    const names = Object.keys(server._registeredTools ?? {});
    expect(names).toEqual(
      expect.arrayContaining([
        "whoami",
        "list_workflows", "list_runs", "get_run", "get_run_logs", "list_workers", "get_queue_metrics",
        "trigger_workflow", "cancel_runs", "replay_runs",
      ]),
    );
    expect(names).toHaveLength(10);
  });

  it("whoami reports tenant/server and ok liveness", async () => {
    const server = createServer(client as any) as any;
    const whoami = server._registeredTools["whoami"];
    // SDK v1.29.0 stores the handler under `.handler`; older builds used `.callback`.
    const handler = whoami.handler ?? whoami.callback ?? whoami.cb;
    const res = await handler({}, {} as any);
    const out = res.content[0].text as string;
    expect(out).toContain("tenant: t1");
    expect(out).toContain("server: https://api.example");
    expect(out).toContain("liveness: ok");
    expect(client.listWorkflows).toHaveBeenCalled();
  });
});
