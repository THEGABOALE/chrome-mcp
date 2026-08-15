/**
 * MCP tools for interacting with page elements (click, fill, key presses,
 * waiting, scrolling). Every tool returns a ToolResult and never throws.
 *
 * click and fill enforce the domain allow-list against the *current* page URL
 * (navigate enforces it against the target URL), using the shared helper in
 * security.ts so the policy is defined once.
 */

import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getPage } from "../browser.js";
import { checkDomainAllowed } from "./security.js";
import {
  type ToolResult,
  textResult,
  errorResult,
  isTimeout,
  errorMessage,
  formatZodError,
} from "./result.js";

export const clickInputSchema = z.object({
  selector: z.string(),
  tabId: z.string().optional(),
});

export type ClickInput = z.infer<typeof clickInputSchema>;

export async function click(input: unknown): Promise<ToolResult> {
  const parsed = clickInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for click: ${formatZodError(parsed.error)}.`,
    );
  }
  const { selector, tabId } = parsed.data;

  try {
    const page = await getPage(tabId);
    const blocked = checkDomainAllowed(page.url(), "interact with");
    if (blocked) {
      return errorResult(blocked);
    }

    await page.locator(selector).click({ timeout: config.defaultTimeoutMs });
    return textResult(`Clicked "${selector}".`);
  } catch (err) {
    logger.error("click failed", err);
    if (isTimeout(err)) {
      return errorResult(
        `Could not click "${selector}" within ${config.defaultTimeoutMs}ms. ` +
          `The element may be missing, hidden, disabled, or covered by another ` +
          `element. Verify the selector and that the element is visible and enabled.`,
      );
    }
    return errorResult(`Could not click "${selector}": ${errorMessage(err)}.`);
  }
}

export const fillInputSchema = z.object({
  selector: z.string(),
  value: z.string(),
  tabId: z.string().optional(),
});

export type FillInput = z.infer<typeof fillInputSchema>;

export async function fill(input: unknown): Promise<ToolResult> {
  const parsed = fillInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for fill: ${formatZodError(parsed.error)}.`,
    );
  }
  const { selector, value, tabId } = parsed.data;

  try {
    const page = await getPage(tabId);
    const blocked = checkDomainAllowed(page.url(), "interact with");
    if (blocked) {
      return errorResult(blocked);
    }

    // fill() only sets the field value; it never submits the form.
    await page
      .locator(selector)
      .fill(value, { timeout: config.defaultTimeoutMs });
    return textResult(
      `Filled "${selector}" with ${value.length} character(s). ` +
        `The form was not submitted.`,
    );
  } catch (err) {
    logger.error("fill failed", err);
    if (isTimeout(err)) {
      return errorResult(
        `Could not fill "${selector}" within ${config.defaultTimeoutMs}ms. ` +
          `The element may be missing, hidden, disabled, or not an editable ` +
          `field. Verify the selector points to a visible, enabled input.`,
      );
    }
    return errorResult(`Could not fill "${selector}": ${errorMessage(err)}.`);
  }
}

export const pressKeyInputSchema = z.object({
  key: z.string(),
  tabId: z.string().optional(),
});

export type PressKeyInput = z.infer<typeof pressKeyInputSchema>;

export async function pressKey(input: unknown): Promise<ToolResult> {
  const parsed = pressKeyInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for press_key: ${formatZodError(parsed.error)}.`,
    );
  }
  const { key, tabId } = parsed.data;

  try {
    const page = await getPage(tabId);
    await page.keyboard.press(key);
    return textResult(`Pressed key "${key}".`);
  } catch (err) {
    logger.error("press_key failed", err);
    return errorResult(
      `Could not press key "${key}": ${errorMessage(err)}. Use names like ` +
        `"Enter", "Tab", "Escape", or combinations like "Control+A".`,
    );
  }
}

export const waitForInputSchema = z.object({
  selector: z.string(),
  tabId: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export type WaitForInput = z.infer<typeof waitForInputSchema>;

export async function waitFor(input: unknown): Promise<ToolResult> {
  const parsed = waitForInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for wait_for: ${formatZodError(parsed.error)}.`,
    );
  }
  const { selector, tabId, timeoutMs } = parsed.data;
  const timeout = timeoutMs ?? config.defaultTimeoutMs;

  try {
    const page = await getPage(tabId);
    await page.locator(selector).waitFor({ state: "visible", timeout });
    return textResult(`Element "${selector}" is now visible.`);
  } catch (err) {
    logger.error("wait_for failed", err);
    if (isTimeout(err)) {
      return errorResult(
        `Element "${selector}" did not become visible within ${timeout}ms. ` +
          `Verify the selector is correct or that the expected content loaded.`,
      );
    }
    return errorResult(
      `Could not wait for "${selector}": ${errorMessage(err)}.`,
    );
  }
}

export const scrollInputSchema = z.object({
  direction: z.enum(["up", "down"]),
  amount: z.number().int().positive().optional(),
  tabId: z.string().optional(),
});

export type ScrollInput = z.infer<typeof scrollInputSchema>;

export async function scroll(input: unknown): Promise<ToolResult> {
  const parsed = scrollInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      `Invalid input for scroll: ${formatZodError(parsed.error)}.`,
    );
  }
  const { direction, amount, tabId } = parsed.data;
  const distance = amount ?? 500;
  const deltaY = direction === "down" ? distance : -distance;

  try {
    const page = await getPage(tabId);
    await page.mouse.wheel(0, deltaY);
    return textResult(`Scrolled ${direction} by ${distance}px.`);
  } catch (err) {
    logger.error("scroll failed", err);
    return errorResult(`Could not scroll: ${errorMessage(err)}.`);
  }
}
