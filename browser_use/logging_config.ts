import {Logger, LogLevel} from './utils';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

function setupLogging(): void {
  const logLevel = process.env.BROWSER_USE_LOGGING_LEVEL?.toLowerCase() || 'info';
  // 设置日志级别
  Logger.setGlobalLogLevel(logLevel as LogLevel);
  // 输出日志设置完成信息
  new Logger('browser_use').info(`BrowserUse logging setup complete with level ${logLevel}`);
}

// 导出函数和类
export {setupLogging};