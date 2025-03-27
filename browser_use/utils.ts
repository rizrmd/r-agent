export type LogLevel = 'debug' | 'info';

export class Logger {
  private static globalLevel: LogLevel = 'info';
  private name: string;
  private level: string;

  constructor(name: string) {
    this.name = name;
  }
  setLogLevel(level: LogLevel) {
    this.level = level || Logger.globalLevel;
  }
  isDebugEnabled() {
    return !!process.env.DEBUG || this.level === 'debug' || this.level === 'trace';
  }
  log(...args: any[]) {
    console.log(`[${this.name}]`, ...args);
  }
  debug(...args: any[]) {
    if (!this.isDebugEnabled()) {
      return;
    }
    console.debug(`[${this.name}]`, ...args);
  }
  trace(...args: any[]) {
    if (!this.isDebugEnabled()) {
      return;
    }
    console.trace(`[${this.name}]`, ...args);
  }
  info(...args: any[]) {
    console.info(`[${this.name}]`, ...args);
  }
  warn(...args: any[]) {
    console.warn(`[${this.name}]`, ...args);
  }
  warning(...args: any[]) {
    console.warn(`[${this.name}]`, ...args);
  }
  error(...args: any[]) {
    console.error(`[${this.name}]`, ...args);
  }

  static setGlobalLogLevel(level: LogLevel) {
    Logger.globalLevel = level;
  }
}

const logger = new Logger('utils');

/**
 * Decorator for timing asynchronous function execution
 */
export function timeExecutionAsync(additionalText: string = '') {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const result = await originalMethod.apply(this, args);
      const executionTime = (Date.now() - startTime) / 1000;
      logger.debug(`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`);
      return result;
    };
  };
}

export function timeExecutionSync(additionalText: string = '') {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const startTime = Date.now();
      const result = originalMethod.apply(this, args);
      const executionTime = (Date.now() - startTime) / 1000;
      logger.debug(`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`);
      return result;
    };
  };
}


/**
 * Singleton pattern implementation
 */
export function singleton<T extends new (...args: any[]) => any>(constructor: T) {
  let instance: InstanceType<T> | null = null;

  return class extends constructor {
    constructor(...args: any[]) {
      if (!instance) {
        super(...args);
        instance = this as InstanceType<T>;
      }

      return instance!;
    }
  } as T;
}