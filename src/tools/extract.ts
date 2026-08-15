/**
 * MCP tools for extracting content from the current page (readable text,
 * markdown, raw HTML, screenshots).
 */

import { z } from "zod";

export const extractReadableInputSchema = z.object({});

export type ExtractReadableInput = z.infer<typeof extractReadableInputSchema>;

export async function extractReadable(
  input: ExtractReadableInput,
): Promise<string> {
  throw new Error("not implemented");
}

export const extractMarkdownInputSchema = z.object({});

export type ExtractMarkdownInput = z.infer<typeof extractMarkdownInputSchema>;

export async function extractMarkdown(
  input: ExtractMarkdownInput,
): Promise<string> {
  throw new Error("not implemented");
}

export const extractHtmlInputSchema = z.object({
  selector: z.string().optional(),
});

export type ExtractHtmlInput = z.infer<typeof extractHtmlInputSchema>;

export async function extractHtml(input: ExtractHtmlInput): Promise<string> {
  throw new Error("not implemented");
}

export const screenshotInputSchema = z.object({
  fullPage: z.boolean().optional(),
});

export type ScreenshotInput = z.infer<typeof screenshotInputSchema>;

export async function screenshot(
  input: ScreenshotInput,
): Promise<Buffer> {
  throw new Error("not implemented");
}
