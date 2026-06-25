const LOG_PREFIX = "[clod-phase2]";

let verboseMode = false;

export function setVerboseLogging(enabled: boolean): void {
  verboseMode = enabled;
}

export const logger = {
  debug(...args: unknown[]): void {
    if (verboseMode) console.debug(LOG_PREFIX, ...args);
  },

  info(...args: unknown[]): void {
    console.info(LOG_PREFIX, ...args);
  },

  warn(...args: unknown[]): void {
    console.warn(LOG_PREFIX, ...args);
  },

  error(...args: unknown[]): void {
    console.error(LOG_PREFIX, ...args);
  },
};
