/**
 * Configuration for chrome-mcp, read and validated from environment
 * variables.
 */

import path from "node:path";
import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value?.toLowerCase() === "true");

const intFromEnv = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === "") {
        return defaultValue;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected a positive integer, received "${value}"`,
        });
        return z.NEVER;
      }
      return parsed;
    });

const envSchema = z.object({
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  CHROME_PATH: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  CHROME_USER_DATA_DIR: z
    .string()
    .optional()
    .transform((value) =>
      value && value.length > 0
        ? value
        : path.join("C:", "chrome-mcp-profile"),
    ),
  CDP_PORT: intFromEnv(9222),
  CDP_CONNECT_TIMEOUT_MS: intFromEnv(10_000),
  ALLOWED_DOMAINS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((domain) => domain.trim())
            .filter((domain) => domain.length > 0)
        : [],
    ),
  ALLOW_EVAL: booleanFromEnv.default("false"),
  DEFAULT_TIMEOUT_MS: intFromEnv(30_000),
  MAX_CONTENT_CHARS: intFromEnv(20_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid configuration: ${parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`,
  );
}

export type Config = {
  readonly transport: "stdio" | "http";
  readonly chromePath: string | undefined;
  readonly chromeUserDataDir: string;
  readonly cdpPort: number;
  readonly cdpConnectTimeoutMs: number;
  readonly allowedDomains: readonly string[];
  readonly allowEval: boolean;
  readonly defaultTimeoutMs: number;
  readonly maxContentChars: number;
};

export const config: Config = Object.freeze({
  transport: parsed.data.TRANSPORT,
  chromePath: parsed.data.CHROME_PATH,
  chromeUserDataDir: parsed.data.CHROME_USER_DATA_DIR,
  cdpPort: parsed.data.CDP_PORT,
  cdpConnectTimeoutMs: parsed.data.CDP_CONNECT_TIMEOUT_MS,
  allowedDomains: Object.freeze(parsed.data.ALLOWED_DOMAINS),
  allowEval: parsed.data.ALLOW_EVAL,
  defaultTimeoutMs: parsed.data.DEFAULT_TIMEOUT_MS,
  maxContentChars: parsed.data.MAX_CONTENT_CHARS,
});
