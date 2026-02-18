export type LogLevel = "debug" | "info" | "warn" | "error";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export const logger = {
  debug(...args: unknown[]) {
    if (levels[currentLevel] <= levels.debug) console.log(...args);
  },
  info(...args: unknown[]) {
    if (levels[currentLevel] <= levels.info) console.log(...args);
  },
  warn(...args: unknown[]) {
    if (levels[currentLevel] <= levels.warn) console.warn(...args);
  },
  error(...args: unknown[]) {
    if (levels[currentLevel] <= levels.error) console.error(...args);
  },
};
