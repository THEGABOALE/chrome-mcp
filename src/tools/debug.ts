/**
 * MCP tools for debugging the page (console logs, network requests, JS
 * evaluation gated by ALLOW_EVAL).
 */

import { z } from "zod";

export const getConsoleLogsInputSchema = z.object({
  limit: z.number().optional(),
});

export type GetConsoleLogsInput = z.infer<typeof getConsoleLogsInputSchema>;

export async function getConsoleLogs(
  input: GetConsoleLogsInput,
): Promise<string[]> {
  throw new Error("not implemented");
}

export const getNetworkRequestsInputSchema = z.object({
  limit: z.number().optional(),
});

export type GetNetworkRequestsInput = z.infer<
  typeof getNetworkRequestsInputSchema
>;

export async function getNetworkRequests(
  input: GetNetworkRequestsInput,
): Promise<string[]> {
  throw new Error("not implemented");
}

export const evaluateScriptInputSchema = z.object({
  script: z.string(),
});

export type EvaluateScriptInput = z.infer<typeof evaluateScriptInputSchema>;

export async function evaluateScript(
  input: EvaluateScriptInput,
): Promise<unknown> {
  throw new Error("not implemented");
}
