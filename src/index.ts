/**
 * chrome-mcp entrypoint. Starts the MCP server on the configured transport.
 *
 * stdout is reserved for JSON-RPC protocol traffic when using the stdio
 * transport — all diagnostic output must go through src/logger.ts (stderr).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

function createServer(): Server {
  throw new Error("not implemented");
}

async function startStdioTransport(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttpTransport(server: Server): Promise<void> {
  throw new Error("not implemented");
}

async function main(): Promise<void> {
  logger.info(`Starting chrome-mcp with transport "${config.transport}"`);

  const server = createServer();

  if (config.transport === "stdio") {
    await startStdioTransport(server);
  } else {
    await startHttpTransport(server);
  }
}

main().catch((error) => {
  logger.error("Fatal error during startup", error);
  process.exit(1);
});
