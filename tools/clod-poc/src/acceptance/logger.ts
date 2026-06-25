import type { Logger } from "./acceptanceTypes.js";

export function createLogger(level: "debug" | "info" | "warn" | "error"): Logger {
  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
  const threshold = LEVELS[level] ?? 1;

  const log = (lvl: keyof typeof LEVELS, message: string, details?: Record<string, unknown>) => {
    if (LEVELS[lvl] < threshold) return;
    const prefix = lvl.toUpperCase();
    if (details && Object.keys(details).length > 0) {
      console.error(`[${prefix}] ${message}`, JSON.stringify(details));
    } else {
      console.error(`[${prefix}] ${message}`);
    }
  };

  return {
    debug: (msg, details?) => log("debug", msg, details),
    info: (msg, details?) => log("info", msg, details),
    warn: (msg, details?) => log("warn", msg, details),
    error: (msg, details?) => log("error", msg, details),
  };
}
