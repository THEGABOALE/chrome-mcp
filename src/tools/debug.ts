/**
 * MCP tools for debugging a page: console logs, network requests, and
 * arbitrary JS evaluation. Every tool returns a ToolResult and never throws.
 *
 * Console/network data comes from the per-page buffers that browser.ts starts
 * filling the moment it attaches to a page — nothing captured before that point
 * is available (Playwright does not expose events retroactively).
 */

import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  getPage,
  getConsoleLogs as readConsoleLogs,
  getNetworkRequests as readNetworkRequests,
} from "../browser.js";
import {
  type ToolResult,
  textResult,
  errorResult,
  errorMessage,
  formatZodError,
} from "./result.js";

export const getConsoleLogsInputSchema = z.object({
  tabId: z.string().optional(),
  limit: z.number().int().positive().default(50),
});

export type GetConsoleLogsInput = z.infer<typeof getConsoleLogsInputSchema>;

export async function getConsoleLogs(input: unknown): Promise<ToolResult> {
  const parsed = getConsoleLogsInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for get_console_logs: ${formatZodError(parsed.error)}.`,
    );
  }
  const { tabId, limit } = parsed.data;

  try {
    const page = await getPage(tabId);
    const logs = readConsoleLogs(page);
    if (logs.length === 0) {
      return textResult(
        "No console logs captured for this tab yet. Console output is only " +
          "recorded after the server attaches to the page — navigate or reload " +
          "to capture it.",
      );
    }

    const recent = logs.slice(-limit);
    const t0 = recent[0].timestamp;
    const lines = recent.map(
      (entry) =>
        `[+${entry.timestamp - t0}ms] [${entry.type}] ${entry.text}`,
    );
    return textResult(
      `Console logs (${recent.length} of ${logs.length}):\n${lines.join("\n")}`,
    );
  } catch (err) {
    logger.error("get_console_logs failed", err);
    if (tabId && /no tab found/i.test(errorMessage(err))) {
      return errorResult(errorMessage(err));
    }
    return errorResult(`Could not read console logs: ${errorMessage(err)}.`);
  }
}

export const getNetworkRequestsInputSchema = z.object({
  tabId: z.string().optional(),
  filter: z.string().optional(),
  limit: z.number().int().positive().default(50),
});

export type GetNetworkRequestsInput = z.infer<
  typeof getNetworkRequestsInputSchema
>;

export async function getNetworkRequests(input: unknown): Promise<ToolResult> {
  const parsed = getNetworkRequestsInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for get_network_requests: ${formatZodError(parsed.error)}.`,
    );
  }
  const { tabId, filter, limit } = parsed.data;

  try {
    const page = await getPage(tabId);
    let requests = readNetworkRequests(page);
    if (filter) {
      requests = requests.filter((entry) => entry.url.includes(filter));
    }

    if (requests.length === 0) {
      return textResult(
        filter
          ? `No network requests matching "${filter}" captured for this tab.`
          : "No network requests captured for this tab yet. Requests are only " +
              "recorded after the server attaches — navigate or reload to capture.",
      );
    }

    const recent = requests.slice(-limit);
    const lines = recent.map((entry) => {
      const status =
        entry.status !== null
          ? String(entry.status)
          : entry.failure
            ? `FAILED (${entry.failure})`
            : "pending";
      const duration =
        entry.durationMs !== null ? `${entry.durationMs}ms` : "—";
      return `${entry.method} ${entry.url} → ${status} (${duration})`;
    });
    return textResult(
      `Network requests (${recent.length} of ${requests.length}):\n${lines.join("\n")}`,
    );
  } catch (err) {
    logger.error("get_network_requests failed", err);
    if (tabId && /no tab found/i.test(errorMessage(err))) {
      return errorResult(errorMessage(err));
    }
    return errorResult(
      `Could not read network requests: ${errorMessage(err)}.`,
    );
  }
}

export const evaluateJsInputSchema = z.object({
  code: z.string(),
  tabId: z.string().optional(),
});

export type EvaluateJsInput = z.infer<typeof evaluateJsInputSchema>;

/**
 * SECURITY: this is the only tool that runs arbitrary, caller-supplied code in
 * the page's JavaScript context. It is the real risk surface of this server —
 * everything else drives well-scoped Playwright actions. It is gated behind
 * config.allowEval (ALLOW_EVAL) and disabled by default.
 */
export async function evaluateJs(input: unknown): Promise<ToolResult> {
  const parsed = evaluateJsInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for evaluate_js: ${formatZodError(parsed.error)}.`,
    );
  }
  const { code, tabId } = parsed.data;

  if (!config.allowEval) {
    return errorResult(
      "evaluate_js is disabled. It runs arbitrary JavaScript in the page and " +
        "is off by default. To enable it, set ALLOW_EVAL=true (e.g. in .env) " +
        "and restart the server.",
    );
  }

  try {
    const page = await getPage(tabId);
    // eslint-disable-next-line no-eval -- intentional: arbitrary page-context eval, gated by ALLOW_EVAL.
    const result = await page.evaluate((source) => eval(source), code);

    if (result === undefined) {
      return textResult("Evaluated successfully. Result: undefined.");
    }
    try {
      return textResult(`Result:\n${JSON.stringify(result, null, 2)}`);
    } catch {
      return textResult(
        "Evaluated successfully, but the result is not JSON-serializable " +
          "(e.g. a circular structure).",
      );
    }
  } catch (err) {
    logger.error("evaluate_js failed", err);
    return errorResult(
      `JavaScript evaluation failed: ${errorMessage(err)}. The result may be ` +
        `non-serializable (DOM node/function), or the page's CSP may block eval.`,
    );
  }
}
