#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  logger.info("Starting vectordb-search MCP server");

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  logger.info("MCP server connected via stdio");
}

main().catch((error) => {
  logger.error("Fatal error", { error: String(error) });
  process.exit(1);
});
