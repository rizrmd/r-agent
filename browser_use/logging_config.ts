import { Logger, LogLevel } from "./utils";
function setupLogging(): void {
  const logLevel =
    process.env.BROWSER_USE_LOGGING_LEVEL?.toLowerCase() || "info";
  Logger.setGlobalLogLevel(logLevel as LogLevel);
}
export { setupLogging };
