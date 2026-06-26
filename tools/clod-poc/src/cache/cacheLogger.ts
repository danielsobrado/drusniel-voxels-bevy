import { logger as clodLogger } from "../clod/logger.js";

export const cacheLogger = {
  debug: (msg: string, ...args: unknown[]) => clodLogger.debug(`[cache] ${msg}`, ...args),
  info: (msg: string, ...args: unknown[]) => clodLogger.info(`[cache] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => clodLogger.warn(`[cache] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => clodLogger.error(`[cache] ${msg}`, ...args),
};
