/**
 * Smoke test for the navigation + extract tools against a real page.
 *
 * navigate -> example.com, read_page (markdown), screenshot. Logs lengths and
 * results to stderr. Run with: npx tsx scripts/smoke-tools.ts
 */

import { navigate } from "../src/tools/navigation.js";
import { readPage, screenshot } from "../src/tools/extract.js";
import type { ToolResult } from "../src/tools/result.js";
import { closeBrowser } from "../src/browser.js";
import { logger } from "../src/logger.js";

function textOf(result: ToolResult): string {
  const block = result.content.find((c) => c.type === "text");
  return block && block.type === "text" ? block.text : "";
}

async function main(): Promise<void> {
  logger.info("[smoke-tools] navigate -> https://example.com");
  const nav = await navigate({ url: "https://example.com" });
  logger.info(
    `[smoke-tools] navigate isError=${nav.isError ?? false} | ${textOf(nav).replace(/\n/g, " | ")}`,
  );

  logger.info("[smoke-tools] read_page mode=markdown");
  const md = await readPage({ mode: "markdown" });
  const mdText = textOf(md);
  logger.info(
    `[smoke-tools] read_page isError=${md.isError ?? false} length=${mdText.length}`,
  );
  logger.info(`[smoke-tools] markdown preview:\n${mdText.slice(0, 300)}`);

  logger.info("[smoke-tools] screenshot (viewport)");
  const shot = await screenshot({});
  const image = shot.content.find((c) => c.type === "image");
  if (image && image.type === "image") {
    logger.info(
      `[smoke-tools] screenshot isError=${shot.isError ?? false} ` +
        `mimeType=${image.mimeType} base64Length=${image.data.length} ` +
        `(~${Math.round((image.data.length * 3) / 4 / 1024)} KB decoded)`,
    );
  } else {
    logger.info(
      `[smoke-tools] screenshot isError=${shot.isError ?? false} | ${textOf(shot)}`,
    );
  }

  logger.info("[smoke-tools] closing browser...");
  await closeBrowser();
  logger.info("[smoke-tools] done.");
}

main().catch((err) => {
  logger.error("[smoke-tools] failed", err);
  process.exit(1);
});
