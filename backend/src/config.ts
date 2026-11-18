import { DEFAULT_DASHBOARD_DIRECTORY } from './dashboard.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  databaseUrl: string;
  tcpHost: string;
  tcpPort: number;
  httpHost: string;
  httpPort: number;
  dashboardDir: string;
  logLevel: LogLevel;
}

function readRequired(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();

  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readOptional(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? fallback : value;
}

function readPort(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(readOptional(env, name, String(fallback)));

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return value;
}

function readLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const value = readOptional(env, 'LOG_LEVEL', 'info');

  if (!LOG_LEVELS.includes(value as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  }

  return value as LogLevel;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: readRequired(env, 'DATABASE_URL'),
    tcpHost: readOptional(env, 'TCP_HOST', '0.0.0.0'),
    tcpPort: readPort(env, 'TCP_PORT', 9000),
    httpHost: readOptional(env, 'HTTP_HOST', '0.0.0.0'),
    httpPort: readPort(env, 'HTTP_PORT', 3000),
    dashboardDir: readOptional(env, 'DASHBOARD_DIR', DEFAULT_DASHBOARD_DIRECTORY),
    logLevel: readLogLevel(env),
  };
}
