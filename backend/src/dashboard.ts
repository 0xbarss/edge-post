import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

import type { Logger } from './logger.js';

export const DEFAULT_DASHBOARD_DIRECTORY = fileURLToPath(
  new URL('../../dashboard/dist', import.meta.url),
);

const MISSING_BUILD_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>edge-post dashboard</title>
  </head>
  <body>
    <main>
      <h1>Dashboard build not found</h1>
      <p>Run <code>npm install</code> and <code>npm run build</code> in <code>dashboard/</code>.</p>
    </main>
  </body>
</html>
`;

export function registerDashboard(app: FastifyInstance, directory: string, logger: Logger): void {
  if (!existsSync(directory)) {
    logger.warn({ directory }, 'dashboard build not found; serving a placeholder page');
    app.get('/', async (_request, reply) => {
      return reply.code(503).type('text/html; charset=utf-8').send(MISSING_BUILD_PAGE);
    });
    return;
  }

  app.register(fastifyStatic, {
    root: directory,
    prefix: '/',
    index: ['index.html'],
  });
}
