/**
 * MCP tools for extracting content from a page (readable markdown, plain text,
 * raw HTML, screenshots, element queries). Every tool returns a ToolResult and
 * never throws.
 */

import { z } from "zod";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getPage } from "../browser.js";
import {
  type ToolResult,
  textResult,
  errorResult,
  imageResult,
  isTimeout,
  errorMessage,
  formatZodError,
} from "./result.js";

/** Above this size a PNG screenshot is re-encoded as JPEG to save bandwidth. */
const JPEG_THRESHOLD_BYTES = 1024 * 1024;

/**
 * Truncates text to config.maxContentChars, appending a marker (with the
 * original length) when truncation occurred.
 */
function truncate(text: string): string {
  const original = text.length;
  if (original <= config.maxContentChars) {
    return text;
  }
  return (
    text.slice(0, config.maxContentChars) +
    `\n\n[... truncado, contenido original tenía ${original} caracteres]`
  );
}

/**
 * Extracts the main article content via Readability and converts it to
 * Markdown with Turndown. Returns fellBack=true when Readability finds no
 * usable content (empty SPAs / apps), so the caller can fall back to text.
 */
function extractMarkdown(
  html: string,
  url: string,
): { markdown: string; fellBack: boolean } {
  // Route jsdom's internal errors to stderr (never stdout — protocol channel).
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => {
    logger.debug(`jsdom: ${err.message}`);
  });

  const dom = new JSDOM(html, { url, virtualConsole });
  const article = new Readability(dom.window.document).parse();

  if (!article || !article.content || article.textContent.trim() === "") {
    return { markdown: "", fellBack: true };
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  const body = turndown.turndown(article.content);
  const markdown = article.title ? `# ${article.title}\n\n${body}` : body;
  return { markdown, fellBack: false };
}

export const readPageInputSchema = z.object({
  tabId: z.string().optional(),
  mode: z.enum(["markdown", "text", "html"]),
});

export type ReadPageInput = z.infer<typeof readPageInputSchema>;

export async function readPage(input: unknown): Promise<ToolResult> {
  const parsed = readPageInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for read_page: ${formatZodError(parsed.error)}. ` +
        `mode must be one of "markdown", "text", or "html".`,
    );
  }
  const { tabId, mode } = parsed.data;

  try {
    const page = await getPage(tabId);
    let note = "";
    let body: string;

    if (mode === "html") {
      body = await page.content();
    } else if (mode === "text") {
      body = await page.innerText("body", {
        timeout: config.defaultTimeoutMs,
      });
    } else {
      const html = await page.content();
      const { markdown, fellBack } = extractMarkdown(html, page.url());
      if (fellBack) {
        note =
          "[Readability could not extract main content; " +
          "falling back to plain text]\n\n";
        body = await page.innerText("body", {
          timeout: config.defaultTimeoutMs,
        });
      } else {
        body = markdown;
      }
    }

    return textResult(note + truncate(body));
  } catch (err) {
    logger.error("read_page failed", err);
    if (tabId && /no tab found/i.test(errorMessage(err))) {
      return errorResult(errorMessage(err));
    }
    if (isTimeout(err)) {
      return errorResult(
        `Reading the page timed out after ${config.defaultTimeoutMs}ms. ` +
          `The page may not have finished loading.`,
      );
    }
    return errorResult(`Could not read the page: ${errorMessage(err)}.`);
  }
}

export const screenshotInputSchema = z.object({
  tabId: z.string().optional(),
  fullPage: z.boolean().optional(),
  selector: z.string().optional(),
});

export type ScreenshotInput = z.infer<typeof screenshotInputSchema>;

export async function screenshot(input: unknown): Promise<ToolResult> {
  const parsed = screenshotInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for screenshot: ${formatZodError(parsed.error)}.`,
    );
  }
  const { tabId, fullPage, selector } = parsed.data;

  try {
    const page = await getPage(tabId);
    const timeout = config.defaultTimeoutMs;

    // PNG first.
    let buffer = selector
      ? await page.locator(selector).screenshot({ timeout })
      : await page.screenshot({ fullPage: fullPage ?? false, timeout });
    let mimeType = "image/png";

    // Re-encode large captures as JPEG (Playwright encodes natively; no sharp).
    if (buffer.length > JPEG_THRESHOLD_BYTES) {
      logger.debug(
        `Screenshot is ${buffer.length} bytes (> 1MB); re-encoding as JPEG q70`,
      );
      buffer = selector
        ? await page
            .locator(selector)
            .screenshot({ type: "jpeg", quality: 70, timeout })
        : await page.screenshot({
            fullPage: fullPage ?? false,
            type: "jpeg",
            quality: 70,
            timeout,
          });
      mimeType = "image/jpeg";
    }

    return imageResult(buffer.toString("base64"), mimeType);
  } catch (err) {
    logger.error("screenshot failed", err);
    if (isTimeout(err)) {
      return errorResult(
        selector
          ? `The element "${selector}" did not appear within ${config.defaultTimeoutMs}ms. ` +
              `Check the selector is correct or that the page has loaded.`
          : `Taking the screenshot timed out after ${config.defaultTimeoutMs}ms.`,
      );
    }
    return errorResult(`Could not take the screenshot: ${errorMessage(err)}.`);
  }
}

export const queryElementsInputSchema = z.object({
  selector: z.string(),
  limit: z.number().int().positive().default(20),
});

export type QueryElementsInput = z.infer<typeof queryElementsInputSchema>;

export async function queryElements(input: unknown): Promise<ToolResult> {
  const parsed = queryElementsInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for query_elements: ${formatZodError(parsed.error)}.`,
    );
  }
  const { selector, limit } = parsed.data;

  try {
    const page = await getPage();
    const locator = page.locator(selector);
    const count = await locator.count();

    if (count === 0) {
      return textResult(
        `No elements matched the selector "${selector}". Check the selector ` +
          `is correct or that the page has finished loading.`,
      );
    }

    const shown = Math.min(count, limit);
    const entries: string[] = [];
    for (let i = 0; i < shown; i++) {
      const element = locator.nth(i);

      let text = "";
      try {
        text = (await element.innerText({ timeout: config.defaultTimeoutMs }))
          .replace(/\s+/g, " ")
          .trim();
      } catch {
        // Hidden/detached element — leave text empty rather than fail.
      }
      if (text.length > 200) {
        text = `${text.slice(0, 200)}…`;
      }

      const attrs: string[] = [];
      for (const name of ["id", "class", "href"]) {
        const value = await element.getAttribute(name);
        if (value !== null) {
          attrs.push(`${name}="${value}"`);
        }
      }

      entries.push(
        `${i + 1}. <${attrs.length > 0 ? attrs.join(" ") : "no id/class/href"}>\n` +
          `   text: ${text || "(empty)"}`,
      );
    }

    const header =
      count > shown
        ? `Found ${count} elements matching "${selector}" (showing first ${shown}):`
        : `Found ${count} element(s) matching "${selector}":`;
    return textResult(`${header}\n${entries.join("\n")}`);
  } catch (err) {
    logger.error("query_elements failed", err);
    if (isTimeout(err)) {
      return errorResult(
        `Querying "${selector}" timed out after ${config.defaultTimeoutMs}ms. ` +
          `Check the selector is correct or that the page has loaded.`,
      );
    }
    return errorResult(`Could not query elements: ${errorMessage(err)}.`);
  }
}
