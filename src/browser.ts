/**
 * Chrome connection management: launching Chrome with a dedicated
 * user-data-dir and attaching to it over the DevTools Protocol.
 */

import type { Browser, BrowserContext, Page } from "playwright-core";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
}

/**
 * Launches (or attaches to an already-running) Chrome instance using the
 * configured user-data-dir and CDP port.
 */
export async function launchBrowser(): Promise<BrowserSession> {
  throw new Error("not implemented");
}

/**
 * Returns the active page, creating one if none exists.
 */
export async function getActivePage(
  session: BrowserSession,
): Promise<Page> {
  throw new Error("not implemented");
}

/**
 * Closes the browser session and releases associated resources.
 */
export async function closeBrowser(session: BrowserSession): Promise<void> {
  throw new Error("not implemented");
}
