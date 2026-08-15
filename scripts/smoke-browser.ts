/**
 * Smoke test for src/browser.ts.
 *
 * Launches/attaches to Chrome, navigates to example.com, prints the title,
 * lists the open tabs, and shuts the browser down. All output goes to stderr
 * via the logger. Run with: npx tsx scripts/smoke-browser.ts
 */

import { config } from "../src/config.js";
import { ensureBrowser, getPage, listTabs, closeBrowser } from "../src/browser.js";
import { logger } from "../src/logger.js";

async function main(): Promise<void> {
  logger.info("[smoke] ensuring browser...");
  await ensureBrowser();

  logger.info("[smoke] getting active page...");
  const page = await getPage();

  logger.info("[smoke] navigating to https://example.com ...");
  await page.goto("https://example.com", {
    waitUntil: "domcontentloaded",
    timeout: config.defaultTimeoutMs,
  });

  const title = await page.title();
  logger.info(`[smoke] page title: ${title}`);

  const tabs = await listTabs();
  logger.info(`[smoke] open tabs (${tabs.length}):`);
  for (const tab of tabs) {
    logger.info(`[smoke]   - id=${tab.id} | title="${tab.title}" | url=${tab.url}`);
  }

  logger.info("[smoke] closing browser...");
  await closeBrowser();

  logger.info("[smoke] done.");
}

main().catch((err) => {
  logger.error("[smoke] failed", err);
  process.exit(1);
});
