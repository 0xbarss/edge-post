import { describe, expect, it } from 'vitest';

import { DEFAULT_BOARDS_FILE } from './boards.js';
import { loadConfig } from './config.js';
import { DEFAULT_DASHBOARD_DIRECTORY } from './dashboard.js';

const baseEnv = {
  DATABASE_URL: 'postgres://edge:edge@localhost:5432/edge_post',
};

describe('configuration', () => {
  it('applies defaults for optional settings', () => {
    expect(loadConfig(baseEnv)).toEqual({
      databaseUrl: 'postgres://edge:edge@localhost:5432/edge_post',
      tcpHost: '0.0.0.0',
      tcpPort: 9000,
      httpHost: '0.0.0.0',
      httpPort: 3000,
      dashboardDir: DEFAULT_DASHBOARD_DIRECTORY,
      boardsFile: DEFAULT_BOARDS_FILE,
      logLevel: 'info',
    });
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      ...baseEnv,
      TCP_HOST: '127.0.0.1',
      TCP_PORT: '9100',
      HTTP_HOST: '127.0.0.1',
      HTTP_PORT: '3100',
      DASHBOARD_DIR: '/srv/dashboard',
      BOARDS_FILE: '/srv/boards/boards.json',
      LOG_LEVEL: 'debug',
    });

    expect(config).toMatchObject({
      tcpHost: '127.0.0.1',
      tcpPort: 9100,
      httpHost: '127.0.0.1',
      httpPort: 3100,
      dashboardDir: '/srv/dashboard',
      boardsFile: '/srv/boards/boards.json',
      logLevel: 'debug',
    });
  });

  it('requires a database URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ ...baseEnv, TCP_PORT: 'abc' })).toThrow(/TCP_PORT/);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...baseEnv, HTTP_PORT: '70000' })).toThrow(/HTTP_PORT/);
  });

  it('rejects an empty database URL', () => {
    expect(() => loadConfig({ DATABASE_URL: ' ' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ ...baseEnv, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
