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
