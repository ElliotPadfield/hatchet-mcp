#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig } from "./hatchet/auth.js";
import { HatchetClient } from "./hatchet/client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = resolveConfig(process.env);
  } catch (e) {
    // stderr only — stdout is the JSON-RPC channel.
    process.stderr.write(`hatchet-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  }
  const client = new HatchetClient(config);
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`hatchet-mcp connected (tenant ${config.tenantId} @ ${config.apiBase})\n`);
}

main().catch((e) => {
  process.stderr.write(`hatchet-mcp fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
