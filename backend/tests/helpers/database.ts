import { readFile } from 'node:fs/promises';

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { createPool } from '../../src/db.js';

const connectionString = process.env.TEST_DATABASE_URL;

export interface TestDatabase {
  pool: Pool;
}

async function applySchema(pool: Pool): Promise<void> {
  const schema = await readFile(new URL('../../schema.sql', import.meta.url), 'utf8');
  await pool.query('DROP TABLE IF EXISTS commands, readings, devices CASCADE');
  await pool.query(schema);
}

async function truncateAll(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE commands, readings, devices RESTART IDENTITY CASCADE');
}

export function useTestDatabase(): TestDatabase {
  if (connectionString === undefined || connectionString === '') {
    throw new Error('TEST_DATABASE_URL is required to run integration tests');
  }

  const pool = createPool(connectionString);

  beforeAll(async () => {
    await applySchema(pool);
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  return { pool };
}
