/**
 * MCP tools for interacting with page elements (click, type, select, etc).
 */

import { z } from "zod";

export const clickInputSchema = z.object({
  selector: z.string(),
});

export type ClickInput = z.infer<typeof clickInputSchema>;

export async function click(input: ClickInput): Promise<void> {
  throw new Error("not implemented");
}

export const typeTextInputSchema = z.object({
  selector: z.string(),
  text: z.string(),
});

export type TypeTextInput = z.infer<typeof typeTextInputSchema>;

export async function typeText(input: TypeTextInput): Promise<void> {
  throw new Error("not implemented");
}

export const selectOptionInputSchema = z.object({
  selector: z.string(),
  value: z.string(),
});

export type SelectOptionInput = z.infer<typeof selectOptionInputSchema>;

export async function selectOption(
  input: SelectOptionInput,
): Promise<void> {
  throw new Error("not implemented");
}

export const waitForSelectorInputSchema = z.object({
  selector: z.string(),
  timeoutMs: z.number().optional(),
});

export type WaitForSelectorInput = z.infer<
  typeof waitForSelectorInputSchema
>;

export async function waitForSelector(
  input: WaitForSelectorInput,
): Promise<void> {
  throw new Error("not implemented");
}
