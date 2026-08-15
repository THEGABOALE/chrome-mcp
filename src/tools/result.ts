/**
 * Shared return-shape helpers for MCP tools.
 *
 * Every tool returns { content: ContentBlock[], isError?: boolean }, which is
 * structurally compatible with the MCP SDK's CallToolResult. Errors are never
 * thrown out of a tool: they are caught, logged, and returned as an isError
 * text block with an actionable message.
 */

import type { ZodError } from "zod";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type ContentBlock = TextContent | ImageContent;

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function imageResult(data: string, mimeType: string): ToolResult {
  return { content: [{ type: "image", data, mimeType }] };
}

/** True for Playwright's TimeoutError (element/navigation waits). */
export function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
