// ClawChat — Logger
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.CLAWCHAT_LOG_LEVEL as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, module: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[clawchat][${level.toUpperCase()}][${module}] ${message}`;
}

export const logger = {
  debug(module: string, message: string, ...args: unknown[]): void {
    if (shouldLog("debug")) console.debug(formatMessage("debug", module, message), ...args);
  },
  info(module: string, message: string, ...args: unknown[]): void {
    if (shouldLog("info")) console.info(formatMessage("info", module, message), ...args);
  },
  warn(module: string, message: string, ...args: unknown[]): void {
    if (shouldLog("warn")) console.warn(formatMessage("warn", module, message), ...args);
  },
  error(module: string, message: string, ...args: unknown[]): void {
    if (shouldLog("error")) console.error(formatMessage("error", module, message), ...args);
  },
};
