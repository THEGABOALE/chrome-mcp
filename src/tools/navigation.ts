/**
 * MCP tools for navigating the browser (go to URL, back/forward, reload, list
 * tabs). Every tool returns a ToolResult and never throws — failures come back
 * as an isError text block with an actionable message.
 */

import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getPage, listTabs as listBrowserTabs } from "../browser.js";
import {
  type ToolResult,
  textResult,
  errorResult,
  isTimeout,
  errorMessage,
  formatZodError,
} from "./result.js";

export const navigateInputSchema = z.object({
  url: z.string().url(),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .default("load"),
});

export type NavigateInput = z.infer<typeof navigateInputSchema>;

export async function navigate(input: unknown): Promise<ToolResult> {
  const parsed = navigateInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for navigate: ${formatZodError(parsed.error)}. ` +
        `Provide a valid absolute URL, e.g. https://example.com.`,
    );
  }
  const { url, waitUntil } = parsed.data;

  // Domain allow-list check (empty list = everything allowed).
  const hostname = new URL(url).hostname;
  if (
    config.allowedDomains.length > 0 &&
    !config.allowedDomains.includes(hostname)
  ) {
    return errorResult(
      `Navigation to "${hostname}" is blocked. Allowed domains: ` +
        `${config.allowedDomains.join(", ")}. Add it to ALLOWED_DOMAINS to permit it.`,
    );
  }

  try {
    const page = await getPage();
    await page.goto(url, { waitUntil, timeout: config.defaultTimeoutMs });
    const finalUrl = page.url();
    const title = await page.title();
    return textResult(
      `Navigated to ${finalUrl}\nTitle: ${title || "(untitled)"}`,
    );
  } catch (err) {
    logger.error("navigate failed", err);
    if (isTimeout(err)) {
      return errorResult(
        `Navigation to ${url} did not complete within ` +
          `${config.defaultTimeoutMs}ms (waitUntil="${waitUntil}"). The page ` +
          `may be slow or unreachable, or it never reached that load state.`,
      );
    }
    return errorResult(`Could not navigate to ${url}: ${errorMessage(err)}.`);
  }
}

export async function goBack(): Promise<ToolResult> {
  try {
    const page = await getPage();
    const response = await page.goBack({ timeout: config.defaultTimeoutMs });
    if (!response) {
      return textResult("There is no previous page in the history.");
    }
    return textResult(
      `Went back to ${page.url()}\nTitle: ${(await page.title()) || "(untitled)"}`,
    );
  } catch (err) {
    logger.error("go_back failed", err);
    if (isTimeout(err)) {
      return errorResult(
        `Going back timed out after ${config.defaultTimeoutMs}ms.`,
      );
    }
    return errorResult(`Could not go back: ${errorMessage(err)}.`);
  }
}

export async function goForward(): Promise<ToolResult> {
  try {
    const page = await getPage();
    const response = await page.goForward({
      timeout: config.defaultTimeoutMs,
    });
    if (!response) {
      return textResult("There is no forward page in the history.");
    }
    return textResult(
      `Went forward to ${page.url()}\nTitle: ${(await page.title()) || "(untitled)"}`,
    );
  } catch (err) {
    logger.error("go_forward failed", err);
    if (isTimeout(err)) {
      return errorResult(
        `Going forward timed out after ${config.defaultTimeoutMs}ms.`,
      );
    }
    return errorResult(`Could not go forward: ${errorMessage(err)}.`);
  }
}

export async function reload(): Promise<ToolResult> {
  try {
    const page = await getPage();
    await page.reload({ timeout: config.defaultTimeoutMs });
    return textResult(
      `Reloaded ${page.url()}\nTitle: ${(await page.title()) || "(untitled)"}`,
    );
  } catch (err) {
    logger.error("reload failed", err);
    if (isTimeout(err)) {
      return errorResult(
        `Reload did not complete within ${config.defaultTimeoutMs}ms.`,
      );
    }
    return errorResult(`Could not reload the page: ${errorMessage(err)}.`);
  }
}

export async function listTabs(): Promise<ToolResult> {
  try {
    const tabs = await listBrowserTabs();
    if (tabs.length === 0) {
      return textResult("No open tabs.");
    }
    const lines = tabs.map(
      (tab, index) =>
        `${index + 1}. [${tab.id}] ${tab.title || "(untitled)"}\n   ${tab.url}`,
    );
    return textResult(`Open tabs (${tabs.length}):\n${lines.join("\n")}`);
  } catch (err) {
    logger.error("list_tabs failed", err);
    return errorResult(`Could not list tabs: ${errorMessage(err)}.`);
  }
}
