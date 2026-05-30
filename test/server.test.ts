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
