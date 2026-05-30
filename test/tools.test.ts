import { describe, it, expect, vi } from "vitest";
import { registerObservabilityTools } from "../src/tools/observability.js";
import { registerActionTools } from "../src/tools/actions.js";

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
