/**
 * Logger for chrome-mcp.
 *
 * Writes exclusively to stderr. Under the stdio MCP transport, stdout is
 * reserved for JSON-RPC protocol messages — any write to stdout (including
 * console.log) silently corrupts the protocol stream. Never write to stdout
 * from this module or anywhere else in the codebase.
 */

const LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LEVELS)[number];

function levelRank(level: LogLevel): number {
  return LEVELS.indexOf(level);
}

function resolveConfiguredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw && (LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return "info";
}

const configuredLevel = resolveConfiguredLevel();

function write(level: LogLevel, message: string, meta?: unknown): void {
  if (levelRank(level) < levelRank(configuredLevel)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (meta !== undefined) {
    process.stderr.write(`${line} ${formatMeta(meta)}\n`);
  } else {
    process.stderr.write(`${line}\n`);
  }
}

function formatMeta(meta: unknown): string {
  if (meta instanceof Error) {
    return meta.stack ?? meta.message;
  }
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export const logger = {
  debug(message: string, meta?: unknown): void {
    write("debug", message, meta);
  },
  info(message: string, meta?: unknown): void {
    write("info", message, meta);
  },
  warn(message: string, meta?: unknown): void {
    write("warn", message, meta);
  },
  error(message: string, meta?: unknown): void {
    write("error", message, meta);
  },
};
