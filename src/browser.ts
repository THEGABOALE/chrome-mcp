/**
 * Chrome connection management.
 *
 * Attaches to a Chrome instance over the DevTools Protocol using Playwright.
 * If no instance is already listening on the configured CDP port, a new Chrome
 * process is launched with a dedicated `--user-data-dir` (required from Chrome
 * 136+, which refuses DevTools connections to the default profile).
 *
 * The browser is managed as a singleton: concurrent callers of
 * `ensureBrowser()` share a single in-flight launch/connect, so we never spawn
 * two Chrome processes in parallel.
 *
 * All diagnostic output goes through the stderr logger — never console.log.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import { config } from "./config.js";
import { logger } from "./logger.js";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
}

export interface TabInfo {
  id: string;
  title: string;
  url: string;
}

/** Exponential-backoff schedule for reconnecting after a launch. */
const INITIAL_BACKOFF_MS = 100;
const BACKOFF_FACTOR = 2;

// Singleton state.
let session: BrowserSession | null = null;
let inFlight: Promise<BrowserSession> | null = null;
/** True only when this process spawned Chrome (so we own its lifecycle). */
let launchedByUs = false;
let chromeProcess: ChildProcess | null = null;

function cdpEndpoint(): string {
  return `http://127.0.0.1:${config.cdpPort}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves the path to chrome.exe, trying (in order): the configured
 * CHROME_PATH, then the standard Windows install locations. The first path
 * that exists on disk wins.
 */
function resolveChromePath(): string {
  const candidates: string[] = [];

  if (config.chromePath) {
    candidates.push(config.chromePath);
  }

  const programFiles = process.env["ProgramFiles"];
  if (programFiles) {
    candidates.push(
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    );
  }

  const programFilesX86 = process.env["ProgramFiles(x86)"];
  if (programFilesX86) {
    candidates.push(
      path.join(
        programFilesX86,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    );
  }

  const localAppData = process.env["LOCALAPPDATA"];
  if (localAppData) {
    candidates.push(
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      logger.debug(`Found Chrome executable at ${candidate}`);
      return candidate;
    }
  }

  throw new Error(
    `Could not locate chrome.exe. Checked: ${
      candidates.length > 0 ? candidates.join(", ") : "(no candidate paths)"
    }. Set the CHROME_PATH environment variable to the full path of ` +
      `chrome.exe (e.g. CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe).`,
  );
}

/**
 * Builds a session wrapper around a connected browser, selecting the default
 * browser context (or creating one if the browser exposes none).
 */
async function buildSession(browser: Browser): Promise<BrowserSession> {
  const contexts = browser.contexts();
  const context =
    contexts.length > 0 ? contexts[0] : await browser.newContext();
  logger.info(
    `Browser session ready (${context.pages().length} open page(s))`,
  );
  return { browser, context };
}

/**
 * Launches Chrome as a child process with a dedicated user-data-dir and the
 * remote debugging port enabled.
 */
function launchChrome(): void {
  const chromePath = resolveChromePath();
  const args = [
    `--remote-debugging-port=${config.cdpPort}`,
    `--user-data-dir=${config.chromeUserDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  logger.info(
    `Launching Chrome: ${chromePath} (port ${config.cdpPort}, ` +
      `profile ${config.chromeUserDataDir})`,
  );

  const child = spawn(chromePath, args, {
    stdio: "ignore",
    detached: false,
  });

  child.on("error", (err) => {
    logger.error("Chrome process error", err);
  });
  child.on("exit", (code, signal) => {
    logger.warn(`Chrome process exited (code=${code}, signal=${signal})`);
    // If Chrome dies on its own, drop the stale session so the next
    // ensureBrowser() re-launches instead of using a dead connection.
    if (chromeProcess === child) {
      session = null;
      chromeProcess = null;
      launchedByUs = false;
    }
  });

  chromeProcess = child;
  launchedByUs = true;
}

/**
 * Repeatedly attempts to connect over CDP using exponential backoff, bounded
 * by config.cdpConnectTimeoutMs total. Used right after launching Chrome,
 * which needs a moment to open its debugging socket.
 */
async function connectWithBackoff(): Promise<Browser> {
  const endpoint = cdpEndpoint();
  const deadline = Date.now() + config.cdpConnectTimeoutMs;
  let delay = INITIAL_BACKOFF_MS;
  let attempt = 0;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Chrome did not respond on CDP port ${config.cdpPort} within ` +
          `${config.cdpConnectTimeoutMs}ms after launch. Verify Chrome can ` +
          `start with --user-data-dir=${config.chromeUserDataDir} and that ` +
          `the port is not blocked or already in use.`,
      );
    }

    attempt++;
    try {
      const browser = await chromium.connectOverCDP(endpoint, {
        timeout: remaining,
      });
      logger.info(`Connected to launched Chrome on attempt ${attempt}`);
      return browser;
    } catch {
      const wait = Math.min(delay, Math.max(deadline - Date.now(), 0));
      if (wait <= 0) {
        // Budget exhausted; loop will throw the descriptive error above.
        continue;
      }
      logger.debug(
        `CDP connect attempt ${attempt} failed; retrying in ${wait}ms`,
      );
      await sleep(wait);
      delay *= BACKOFF_FACTOR;
    }
  }
}

async function doEnsureBrowser(): Promise<BrowserSession> {
  const endpoint = cdpEndpoint();

  // 1. Try to attach to an already-running Chrome. If this succeeds we did
  //    not launch it, so we must not kill it on shutdown.
  logger.info(`Checking for an existing Chrome instance at ${endpoint}`);
  try {
    const browser = await chromium.connectOverCDP(endpoint, {
      timeout: config.cdpConnectTimeoutMs,
    });
    launchedByUs = false;
    chromeProcess = null;
    logger.info("Attached to an existing Chrome instance");
    return await buildSession(browser);
  } catch {
    logger.info(
      "No existing Chrome instance on the CDP port; launching a new one",
    );
  }

  // 2. Launch Chrome ourselves and reconnect with backoff.
  launchChrome();
  const browser = await connectWithBackoff();
  return await buildSession(browser);
}

/**
 * Returns the shared browser session, launching/connecting on first use.
 * Concurrent callers share a single in-flight operation.
 */
export async function ensureBrowser(): Promise<BrowserSession> {
  if (session) {
    return session;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = doEnsureBrowser();
  try {
    session = await inFlight;
    return session;
  } finally {
    inFlight = null;
  }
}

/**
 * Reads the CDP target id for a page. This is the same stable id exposed by
 * the /json DevTools endpoint, letting callers reference specific tabs.
 */
async function getPageId(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const info = await cdp.send("Target.getTargetInfo");
    return info.targetInfo.targetId;
  } finally {
    await cdp.detach().catch(() => {
      /* best-effort cleanup */
    });
  }
}

/**
 * Returns a page. With no argument, returns the active tab (the most recently
 * opened page — Playwright does not expose OS focus state), creating one if
 * the context has none. With a tabId, returns the matching page or throws.
 */
export async function getPage(tabId?: string): Promise<Page> {
  const current = await ensureBrowser();
  const pages = current.context.pages();

  if (tabId) {
    for (const page of pages) {
      if ((await getPageId(page)) === tabId) {
        return page;
      }
    }
    throw new Error(`No tab found with id "${tabId}"`);
  }

  if (pages.length === 0) {
    logger.debug("No open pages; creating a new one");
    return current.context.newPage();
  }
  return pages[pages.length - 1];
}

/** Lists the open tabs with their CDP id, title, and URL. */
export async function listTabs(): Promise<TabInfo[]> {
  const current = await ensureBrowser();
  const pages = current.context.pages();

  const tabs: TabInfo[] = [];
  for (const page of pages) {
    const id = await getPageId(page);
    let title = "";
    try {
      title = await page.title();
    } catch {
      // title() can fail on about:blank / closing pages; leave it empty.
    }
    tabs.push({ id, title, url: page.url() });
  }
  return tabs;
}

/**
 * Closes the session. If this process launched Chrome, the Chrome process is
 * terminated; if we attached to a pre-existing instance, we only disconnect
 * and leave it running.
 */
export async function closeBrowser(): Promise<void> {
  const current = session;
  session = null;

  if (!current) {
    return;
  }

  const ownedProcess = chromeProcess;
  const weOwnIt = launchedByUs;
  chromeProcess = null;
  launchedByUs = false;

  try {
    // For a CDP connection, browser.close() disconnects Playwright but does
    // NOT terminate Chrome — so this is the "disconnect" step in both cases.
    await current.browser.close();
  } catch (err) {
    logger.error("Error disconnecting from browser", err);
  }

  if (weOwnIt) {
    if (ownedProcess && ownedProcess.exitCode === null) {
      logger.info("Terminating the Chrome process we launched");
      ownedProcess.kill();
    }
  } else {
    logger.info("Disconnected from pre-existing Chrome (left it running)");
  }
}

// Ensure Chrome is cleaned up on termination signals.
let shuttingDown = false;
async function handleSignal(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down browser`);
  try {
    await closeBrowser();
  } catch (err) {
    logger.error("Error during signal shutdown", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  void handleSignal("SIGINT");
});
process.on("SIGTERM", () => {
  void handleSignal("SIGTERM");
});
