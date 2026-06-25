export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

let globalLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[globalLevel];
}

function formatMsg(level: LogLevel, msg: string, args: unknown[]): string {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[${ts}] [CLOD] [${level.toUpperCase()}]`;
  if (args.length === 0) return `${prefix} ${msg}`;
  return `${prefix} ${msg} ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`;
}

export const logger: Logger = {
  debug(msg: string, ...args: unknown[]) {
    if (shouldLog("debug")) console.debug(formatMsg("debug", msg, args));
  },
  info(msg: string, ...args: unknown[]) {
    if (shouldLog("info")) console.info(formatMsg("info", msg, args));
  },
  warn(msg: string, ...args: unknown[]) {
    if (shouldLog("warn")) console.warn(formatMsg("warn", msg, args));
  },
  error(msg: string, ...args: unknown[]) {
    if (shouldLog("error")) console.error(formatMsg("error", msg, args));
  },
};
