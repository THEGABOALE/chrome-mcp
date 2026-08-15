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

import { spawn, execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
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

export interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
}

export interface NetworkEntry {
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  startedAt: number;
  timestamp: number;
  failure?: string;
}

interface PageBuffers {
  console: ConsoleEntry[];
  requests: NetworkEntry[];
}

/**
 * Per-page circular buffers. Playwright only surfaces console/network events
 * live (never retroactively), so we subscribe as soon as a page appears and
 * keep the most recent entries of each kind to bound memory.
 */
const MAX_CAPTURE_ENTRIES = 200;
const pageBuffers = new WeakMap<Page, PageBuffers>();
const requestEntries = new WeakMap<Request, NetworkEntry>();

function pushCapped<T>(buffer: T[], entry: T): void {
  buffer.push(entry);
  if (buffer.length > MAX_CAPTURE_ENTRIES) {
    buffer.shift();
  }
}

/** Subscribes to a page's console and network events. Idempotent per page. */
function attachPageListeners(page: Page): void {
  if (pageBuffers.has(page)) {
    return;
  }
  const buffers: PageBuffers = { console: [], requests: [] };
  pageBuffers.set(page, buffers);

  page.on("console", (message) => {
    pushCapped(buffers.console, {
      type: message.type(),
      text: message.text(),
      timestamp: Date.now(),
    });
  });

  page.on("request", (request) => {
    const entry: NetworkEntry = {
      method: request.method(),
      url: request.url(),
      status: null,
      durationMs: null,
      startedAt: Date.now(),
      timestamp: Date.now(),
    };
    requestEntries.set(request, entry);
    pushCapped(buffers.requests, entry);
  });

  page.on("response", (response) => {
    const entry = requestEntries.get(response.request());
    if (entry) {
      entry.status = response.status();
      entry.durationMs = Date.now() - entry.startedAt;
    }
  });

  page.on("requestfailed", (request) => {
    const entry = requestEntries.get(request);
    if (entry) {
      entry.durationMs = Date.now() - entry.startedAt;
      entry.failure = request.failure()?.errorText ?? "request failed";
    }
  });

  page.on("close", () => {
    pageBuffers.delete(page);
  });
}

/** Returns the captured console entries for a page (oldest first). */
export function getConsoleLogs(page: Page): ConsoleEntry[] {
  return pageBuffers.get(page)?.console.slice() ?? [];
}

/** Returns the captured network entries for a page (oldest first). */
export function getNetworkRequests(page: Page): NetworkEntry[] {
  return pageBuffers.get(page)?.requests.slice() ?? [];
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
  const built: BrowserSession = { browser, context };

  // The real signal that the browser is gone (crash, external close, or our
  // own shutdown) — drop the singleton so the next ensureBrowser() reconnects.
  browser.on("disconnected", () => {
    if (session === built) {
      logger.warn("Browser connection lost; clearing session");
      session = null;
    }
  });

  // Capture console/network on all current and future pages of this context.
  for (const page of context.pages()) {
    attachPageListeners(page);
  }
  context.on("page", (page) => attachPageListeners(page));

  logger.info(
    `Browser session ready (${context.pages().length} open page(s))`,
  );
  return built;
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
    // On Windows the chrome.exe we spawn is typically a launcher stub that
    // hands off to the real browser process and exits (code 0) almost
    // immediately. That is NOT the browser dying, so we must not touch
    // ownership state here — loss of the actual connection is detected via
    // the Browser 'disconnected' event instead.
    logger.debug(
      `Spawned chrome.exe launcher exited (code=${code}, signal=${signal})`,
    );
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

const execFileAsync = promisify(execFile);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Windows-only, best-effort mitigation for orphaned Chrome. Windows has no
 * catchable SIGTERM, so a hard-killed server (as MCP clients do on shutdown)
 * can leave Chrome running. On startup we terminate any chrome.exe left over
 * from a PREVIOUS chrome-mcp session — identified by BOTH our exact
 * --user-data-dir and --remote-debugging-port on its command line, so we never
 * touch a user's own Chrome. This keeps orphans from piling up across restarts.
 *
 * Never throws: if detection fails (PowerShell missing, permissions, parse
 * error) it logs a warning and lets startup proceed with a normal launch.
 */
async function reclaimOrphanedChrome(): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const uddPattern = new RegExp(
    `--user-data-dir="?${escapeRegExp(config.chromeUserDataDir)}`,
    "i",
  );
  const portPattern = new RegExp(
    `--remote-debugging-port=${config.cdpPort}(?![0-9])`,
  );

  let processes: Array<{ ProcessId: number; CommandLine: string | null }>;
  try {
    // Single-quoted PS script (no double quotes) so Node's arg quoting is safe.
    const script =
      "ConvertTo-Json -Compress -InputObject @(" +
      "Get-CimInstance Win32_Process -ErrorAction Stop | " +
      "Where-Object { $_.Name -eq 'chrome.exe' } | " +
      "Select-Object ProcessId, CommandLine)";
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 10_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    const parsed: unknown = trimmed ? JSON.parse(trimmed) : [];
    processes = Array.isArray(parsed)
      ? (parsed as Array<{ ProcessId: number; CommandLine: string | null }>)
      : [parsed as { ProcessId: number; CommandLine: string | null }];
  } catch (err) {
    logger.warn(
      "Could not scan for orphaned Chrome processes; continuing with launch",
      err,
    );
    return;
  }

  const orphanPids = processes
    .filter(
      (proc) =>
        typeof proc.CommandLine === "string" &&
        uddPattern.test(proc.CommandLine) &&
        portPattern.test(proc.CommandLine),
    )
    .map((proc) => proc.ProcessId)
    .filter((pid) => Number.isInteger(pid) && pid > 0);

  if (orphanPids.length === 0) {
    logger.debug("No orphaned chrome-mcp Chrome processes to reclaim");
    return;
  }

  logger.info(
    `Reclaiming ${orphanPids.length} orphaned chrome-mcp Chrome process(es) ` +
      `from a previous session: PID(s) ${orphanPids.join(", ")}`,
  );

  try {
    await execFileAsync(
      "taskkill",
      ["/F", ...orphanPids.flatMap((pid) => ["/PID", String(pid)])],
      { timeout: 10_000, windowsHide: true },
    );
    logger.info(`Reclaimed ${orphanPids.length} orphaned Chrome process(es)`);
  } catch (err) {
    // taskkill exits non-zero when a PID already died (Chrome children exit
    // with the browser process). Best-effort — not a startup failure.
    logger.debug(
      `taskkill reported an issue (some PIDs may have already exited): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function doEnsureBrowser(): Promise<BrowserSession> {
  const endpoint = cdpEndpoint();

  // Best-effort: kill any orphaned Chrome from a previous chrome-mcp session
  // BEFORE connecting, so we don't re-attach to (and re-leak) our own orphan.
  // Windows-only; a no-op on other platforms. Runs on both the attach and the
  // launch paths.
  await reclaimOrphanedChrome();

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
    const page = await current.context.newPage();
    attachPageListeners(page);
    return page;
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

  if (weOwnIt) {
    // We launched Chrome, so terminate it. The chrome.exe we spawned is only
    // a launcher stub that has already exited, so its pid can't kill the real
    // browser — ask the browser itself to exit over CDP.
    logger.info("Closing the Chrome instance we launched");
    try {
      const cdp = await current.browser.newBrowserCDPSession();
      await cdp.send("Browser.close");
    } catch (err) {
      logger.warn(
        "CDP Browser.close failed; falling back to killing the spawned process",
        err,
      );
    }
    // Best-effort: kill the spawned handle too, in case it is still alive.
    if (ownedProcess && ownedProcess.exitCode === null) {
      ownedProcess.kill();
    }
  }

  try {
    // For a CDP connection, browser.close() just disconnects Playwright (it
    // does not terminate Chrome). After Browser.close above it may already be
    // gone, so ignore errors.
    await current.browser.close();
  } catch {
    /* already disconnected */
  }

  if (!weOwnIt) {
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
