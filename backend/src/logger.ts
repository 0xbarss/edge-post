import type { LogLevel } from './config.js';

export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const LEVEL_WEIGHT: Record<Exclude<LogLevel, 'silent'>, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

type ActiveLevel = 'info' | 'warn' | 'error';

function serializeError(value: Error): Record<string, unknown> {
  return { name: value.name, message: value.message, stack: value.stack };
}

export function createLogger(level: LogLevel): Logger {
  const threshold = level === 'silent' ? Number.POSITIVE_INFINITY : LEVEL_WEIGHT[level];

  function write(activeLevel: ActiveLevel, fields: Record<string, unknown>, message: string): void {
    if (LEVEL_WEIGHT[activeLevel] < threshold) {
      return;
    }

    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level: activeLevel,
      msg: message,
    };

    for (const [key, value] of Object.entries(fields)) {
      record[key] = value instanceof Error ? serializeError(value) : value;
    }

    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  return {
    info: (fields, message) => {
      write('info', fields, message);
    },
    warn: (fields, message) => {
      write('warn', fields, message);
    },
    error: (fields, message) => {
      write('error', fields, message);
    },
  };
}
