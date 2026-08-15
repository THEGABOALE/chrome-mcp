/**
 * End-to-end MCP protocol smoke test using a real MCP client over stdio.
 *
 * Spawns the built server (dist/index.js), lists tools, then calls
 * navigate -> read_page -> list_tabs in a single session so page state persists
 * across calls. Run with: npx tsx scripts/smoke-mcp.ts (requires npm run build).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { logger } from "../src/logger.js";

interface TextBlock {
  type: string;
  text?: string;
}

function textOf(result: { content: unknown }): string {
  const blocks = result.content as TextBlock[];
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });
  const client = new Client(
    { name: "smoke-mcp", version: "0.1.0" },
    { capabilities: {} },
  );

  logger.info("[smoke-mcp] connecting to server...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  logger.info(`[smoke-mcp] tools/list -> ${tools.length} tools`);

  logger.info("[smoke-mcp] tools/call navigate -> https://example.com");
  const nav = await client.callTool({
    name: "navigate",
    arguments: { url: "https://example.com" },
  });
  logger.info(
    `[smoke-mcp] navigate isError=${nav.isError ?? false} | ${textOf(nav).replace(/\n/g, " | ")}`,
  );

  logger.info("[smoke-mcp] tools/call read_page mode=markdown");
  const read = await client.callTool({
    name: "read_page",
    arguments: { mode: "markdown" },
  });
  const readText = textOf(read);
  logger.info(
    `[smoke-mcp] read_page isError=${read.isError ?? false} length=${readText.length}`,
  );
  logger.info(`[smoke-mcp] read_page preview:\n${readText.slice(0, 200)}`);

  logger.info("[smoke-mcp] tools/call list_tabs");
  const tabs = await client.callTool({ name: "list_tabs", arguments: {} });
  logger.info(
    `[smoke-mcp] list_tabs isError=${tabs.isError ?? false}\n${textOf(tabs)}`,
  );

  logger.info("[smoke-mcp] closing client (terminates the server process)");
  await client.close();
  logger.info("[smoke-mcp] done.");
}

main().catch((err) => {
  logger.error("[smoke-mcp] failed", err);
  process.exit(1);
});
