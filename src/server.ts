import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HatchetClient } from "./hatchet/client.js";
import { registerObservabilityTools } from "./tools/observability.js";
import { registerActionTools } from "./tools/actions.js";

export function createServer(client: HatchetClient): McpServer {
  const server = new McpServer({ name: "hatchet-mcp", version: "0.1.0" });

  server.registerTool(
    "whoami",
    {
      description: "Show the resolved Hatchet tenant + server URL and confirm the token works.",
      inputSchema: {},
    },
    async () => {
      let live = "unknown";
      try {
        await client.listWorkflows({ limit: 1 });
        live = "ok";
      } catch (e) {
        live = `failed: ${(e as Error).message}`;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `tenant: ${client.tenantId}\nserver: ${client.apiBase}\nliveness: ${live}`,
          },
        ],
      };
    },
  );

  registerObservabilityTools(server, client);
  registerActionTools(server, client);
  return server;
}
