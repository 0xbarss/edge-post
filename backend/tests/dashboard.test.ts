import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../src/db.js';
import { buildApp } from '../src/routes.js';
import { silentLogger } from './helpers/logger.js';

const pool = createPool('postgres://edge:edge@127.0.0.1:1/unused');

describe('dashboard assets', () => {
  let directory: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edge-post-dashboard-'));
    await mkdir(join(directory, 'assets'));
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>',
    );
    await writeFile(join(directory, 'assets', 'app.js'), 'console.log("dashboard");\n');

    app = buildApp({ pool, logger: silentLogger, dashboardDir: directory });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves the built index page at the root', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<div id="root"></div>');
  });

  it('serves hashed assets from the build directory', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.body).toContain('dashboard');
  });

  it('keeps the API envelope for an unknown path', async () => {
    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'Route not found' },
    });
  });
});

describe('dashboard build fallback', () => {
  it('returns a placeholder when the build directory does not exist', async () => {
    const app = buildApp({
      pool,
      logger: silentLogger,
      dashboardDir: join(tmpdir(), 'edge-post-dashboard-does-not-exist'),
    });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('Dashboard build not found');

    await app.close();
  });
});
