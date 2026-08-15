/**
 * MCP tools for navigating the browser (go to URL, back/forward, reload).
 */

import { z } from "zod";

export const navigateInputSchema = z.object({
  url: z.string().url(),
});

export type NavigateInput = z.infer<typeof navigateInputSchema>;

export async function navigate(input: NavigateInput): Promise<string> {
  throw new Error("not implemented");
}

export const goBackInputSchema = z.object({});

export type GoBackInput = z.infer<typeof goBackInputSchema>;

export async function goBack(input: GoBackInput): Promise<string> {
  throw new Error("not implemented");
}

export const goForwardInputSchema = z.object({});

export type GoForwardInput = z.infer<typeof goForwardInputSchema>;

export async function goForward(input: GoForwardInput): Promise<string> {
  throw new Error("not implemented");
}

export const reloadInputSchema = z.object({});

export type ReloadInput = z.infer<typeof reloadInputSchema>;

export async function reload(input: ReloadInput): Promise<string> {
  throw new Error("not implemented");
}
