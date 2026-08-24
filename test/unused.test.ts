import { describe, it, expect, vi } from "vitest";
import { findUnusedWorkflows, formatUnusedWorkflows } from "../src/unused.js";
import type { UnusedWorkflowClient } from "../src/unused.js";

function wf(id: string, name: string) {
  return { metadata: { id, createdAt: "2026-01-01T00:00:00.000Z" }, name };
}

function makeClient(opts: {
  workflows?: ReturnType<typeof wf>[];
  runsByWorkflow?: Record<string, number>;
}): UnusedWorkflowClient {
  const workflows = opts.workflows ?? [];
  const runsByWorkflow = opts.runsByWorkflow ?? {};
  return {
    listWorkflows: vi.fn(async ({ offset = 0, limit = 100 } = {}) => ({
      rows: workflows.slice(offset, offset + limit),
    })),
    listRuns: vi.fn(async ({ workflowIds } = { since: "" }) => {
      const id = workflowIds?.[0] ?? "";
      const count = runsByWorkflow[id] ?? 0;
      return {
        rows: count
          ? [{ metadata: { id: "r1" }, displayName: "d", status: "COMPLETED", workflowName: "x", workflowId: id, taskExternalId: "t", workflowRunExternalId: "r", createdAt: "2026-08-01T00:00:00.000Z" }]
          : [],
      };
    }),
  };
}

describe("findUnusedWorkflows", () => {
  it("returns definitions with zero runs in the lookback window", async () => {
    const client = makeClient({
      workflows: [wf("w-used", "analyze-batch"), wf("w-dead", "analyze-posts"), wf("w-idle", "analyze-creator")],
      runsByWorkflow: { "w-used": 1 },
    });
    const res = await findUnusedWorkflows(client, { lookbackDays: 14 });
    expect(res.lookbackDays).toBe(14);
    expect(res.workflowCount).toBe(3);
    expect(res.unused.map((w) => w.name)).toEqual(["analyze-creator", "analyze-posts"]);
    expect(client.listRuns).toHaveBeenCalledTimes(3);
    expect(client.listRuns).toHaveBeenCalledWith(
      expect.objectContaining({ workflowIds: ["w-used"], limit: 1, onlyTasks: false }),
    );
  });

  it("paginates workflow list pages", async () => {
    const workflows = Array.from({ length: 101 }, (_, i) => wf(`w-${i}`, `wf-${String(i).padStart(3, "0")}`));
    const client = makeClient({ workflows, runsByWorkflow: Object.fromEntries(workflows.map((w) => [w.metadata.id, 1])) });
    const res = await findUnusedWorkflows(client, { lookbackDays: 7 });
    expect(res.workflowCount).toBe(101);
    expect(res.unused).toEqual([]);
    expect(client.listWorkflows).toHaveBeenCalledTimes(2);
  });

  it("treats a definition with no id as unused", async () => {
    const client = makeClient({ workflows: [{ name: "orphan" } as any] });
    const res = await findUnusedWorkflows(client);
    expect(res.unused).toHaveLength(1);
    expect(client.listRuns).not.toHaveBeenCalled();
  });
});

describe("formatUnusedWorkflows", () => {
  it("lists unused names and ids", () => {
    const out = formatUnusedWorkflows({
      lookbackDays: 30,
      lookbackSince: "2026-07-25T00:00:00.000Z",
      workflowCount: 2,
      unused: [wf("abc", "analyze-posts")],
    });
    expect(out).toContain("Unused (no runs in window): 1");
    expect(out).toContain("analyze-posts");
    expect(out).toContain("id=abc");
    expect(out).toMatch(/delete_workflow/);
  });

  it("says when none are unused", () => {
    const out = formatUnusedWorkflows({
      lookbackDays: 30,
      lookbackSince: "2026-07-25T00:00:00.000Z",
      workflowCount: 4,
      unused: [],
    });
    expect(out).toMatch(/no unused workflow/i);
  });
});
