import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createLogger } from './logger.js';
import { Presence } from './presence.js';
import { buildApp } from './routes.js';
import { TcpServer } from './tcp-server.js';
import { LiveFeed } from './websocket.js';

async function start(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const pool = createPool(config.databaseUrl);
  const liveFeed = new LiveFeed(logger);
  const presence = new Presence(pool, logger, liveFeed);
  const tcpServer = new TcpServer({ pool, logger, presence, live: liveFeed });
  const app = buildApp({ pool, logger, dashboardDir: config.dashboardDir });

  liveFeed.attach(app.server);

  let stopSweep: (() => void) | null = null;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    stopSweep?.();

    try {
      await tcpServer.close();
      await liveFeed.close();
      await app.close();
      await pool.end();
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exitCode = 1;
      return;
    }

    logger.info({}, 'shutdown complete');
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await presence.resetOnStartup();
    stopSweep = presence.startSweep();
    await tcpServer.listen(config.tcpHost, config.tcpPort);
    await app.listen({ host: config.httpHost, port: config.httpPort });
    logger.info({ host: config.httpHost, port: config.httpPort }, 'http server listening');
  } catch (error) {
    logger.error({ err: error }, 'startup failed');
    process.exitCode = 1;
    stopSweep?.();
    await tcpServer.close().catch((closeError: unknown) => {
      logger.error({ err: closeError }, 'failed to close the tcp server');
    });
    await liveFeed.close().catch((closeError: unknown) => {
      logger.error({ err: closeError }, 'failed to close the websocket server');
    });
    await app.close().catch((closeError: unknown) => {
      logger.error({ err: closeError }, 'failed to close the http server');
    });
    await pool.end().catch((closeError: unknown) => {
      logger.error({ err: closeError }, 'failed to close the database pool');
    });
  }
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'startup failed', error: message })}\n`,
  );
  process.exitCode = 1;
});
