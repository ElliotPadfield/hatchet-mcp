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
  getWorkflow: vi.fn(async () => ({ metadata: { id: "w1" }, name: "wf" })),
};

describe("registerObservabilityTools", () => {
  it("registers the expected read tools", () => {
    const s = fakeServer();
    registerObservabilityTools(s as any, fakeClient as any);
    for (const name of ["list_workflows", "get_workflow", "find_unused_workflows", "list_runs", "get_run", "get_run_logs", "list_workers", "get_queue_metrics"]) {
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

  it("find_unused_workflows reports definitions with no recent runs", async () => {
    const s = fakeServer();
    const client = {
      ...fakeClient,
      listWorkflows: vi.fn(async () => ({
        rows: [
          { metadata: { id: "dead" }, name: "analyze-posts" },
          { metadata: { id: "live" }, name: "analyze-batch" },
        ],
      })),
      listRuns: vi.fn(async ({ workflowIds }: { workflowIds?: string[] }) => ({
        rows: workflowIds?.[0] === "live"
          ? [{ metadata: { id: "r" }, displayName: "d", status: "COMPLETED", workflowName: "analyze-batch", workflowId: "live", taskExternalId: "t", workflowRunExternalId: "r", createdAt: "2026-08-01T00:00:00.000Z" }]
          : [],
      })),
    };
    registerObservabilityTools(s as any, client as any);
    const res = await s.tools["find_unused_workflows"].handler({ lookbackDays: 30 });
    expect(res.content[0].text).toContain("analyze-posts");
    expect(res.content[0].text).not.toContain("analyze-batch");
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
  deleteWorkflow: vi.fn(async () => undefined),
};

describe("registerActionTools", () => {
  it("registers trigger/cancel/replay", () => {
    const s = fakeServer();
    registerActionTools(s as any, actionClient as any);
    for (const n of ["trigger_workflow", "cancel_runs", "replay_runs", "delete_workflow"]) {
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

  it("surfaces a client error from cancel_runs as a tool error", async () => {
    const s = fakeServer();
    const failing = { ...actionClient, cancelRuns: vi.fn(async () => { throw new Error("Token lacks permission for this tenant or resource."); }) };
    registerActionTools(s as any, failing as any);
    await expect(s.tools["cancel_runs"].handler({ runIds: ["a"] })).rejects.toThrow(/permission/i);
  });

  it("delete_workflow forwards the definition id", async () => {
    const s = fakeServer();
    registerActionTools(s as any, actionClient as any);
    const res = await s.tools["delete_workflow"].handler({
      workflowId: "11111111-1111-1111-1111-111111111111",
      confirm: true,
    });
    expect(actionClient.deleteWorkflow).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(res.content[0].text).toMatch(/deleted/i);
  });
});
