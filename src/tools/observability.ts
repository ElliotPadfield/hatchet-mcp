import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HatchetClient } from "../hatchet/client.js";
import { formatRunsList, formatRunDetail, formatLogs } from "../format.js";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (v: unknown) => {
  const full = JSON.stringify(v, null, 2);
  const body = full.length > 8000 ? full.slice(0, 8000) + "\n… (truncated)" : full;
  return text("```json\n" + body + "\n```");
};

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
      inputSchema: { runId: z.string().describe("Run id from list_runs output (the id= field)") },
    },
    async ({ runId }) => text(formatRunDetail(await client.getRun(runId))),
  );

  server.registerTool(
    "get_run_logs",
    {
      description: "Get log lines for a task by its external id.",
      inputSchema: {
        taskId: z.string().describe("Task id from get_run's per-task id= field (taskExternalId)"),
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
