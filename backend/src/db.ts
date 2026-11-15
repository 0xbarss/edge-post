import pg from 'pg';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  CommandPayload,
  CommandRow,
  CommandStatus,
  CommandType,
  Device,
  PendingCommand,
  Reading,
  ReadingInput,
} from './models.js';

const { Pool: PgPool } = pg;

const DEVICE_COLUMNS = `
  device_id AS "deviceId",
  name,
  first_seen AS "firstSeen",
  last_seen AS "lastSeen",
  status,
  sample_rate AS "sampleRate"
`;

const READING_COLUMNS = `
  id::text AS id,
  device_id AS "deviceId",
  sequence,
  ts,
  received_at AS "receivedAt",
  temperature::float8 AS temperature,
  gpio_state AS "gpioState",
  sample_rate AS "sampleRate"
`;

const COMMAND_COLUMNS = `
  id,
  device_id AS "deviceId",
  type,
  payload,
  status,
  created_at AS "createdAt",
  delivered_at AS "deliveredAt",
  executed_at AS "executedAt"
`;

const READING_QUERY_LIMIT = 5000;

export function createPool(connectionString: string): Pool {
  return new PgPool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

async function queryRows<T extends QueryResultRow>(
  executor: Pool | PoolClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await executor.query<T>(text, [...values]);
  return result.rows;
}

export async function ingestReading(
  pool: Pool,
  input: ReadingInput,
): Promise<{ device: Device; reading: Reading }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const devices = await queryRows<Device>(
      client,
      `
        INSERT INTO devices (device_id, name, sample_rate, status)
        VALUES ($1, $2, $3, 'online')
        ON CONFLICT (device_id) DO UPDATE
          SET last_seen   = now(),
              status      = 'online',
              sample_rate = EXCLUDED.sample_rate
        RETURNING ${DEVICE_COLUMNS}
      `,
      [input.deviceId, `device-${input.deviceId}`, input.sampleRate],
    );
    const device = devices[0];

    if (device === undefined) {
      throw new Error('Device upsert returned no row');
    }

    const readings = await queryRows<Reading>(
      client,
      `
        INSERT INTO readings (device_id, sequence, ts, temperature, gpio_state, sample_rate)
        VALUES ($1, $2, to_timestamp($3), $4, $5, $6)
        RETURNING ${READING_COLUMNS}
      `,
      [
        input.deviceId,
        input.sequence,
        input.timestamp,
        input.temperatureTenths / 10,
        input.gpioState,
        input.sampleRate,
      ],
    );
    const reading = readings[0];

    if (reading === undefined) {
      throw new Error('Reading insert returned no row');
    }

    await client.query('COMMIT');
    return { device, reading };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Reading transaction failed and the rollback also failed',
        { cause: rollbackError },
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function registerDevice(
  pool: Pool,
  input: { deviceId: number; name: string; sampleRate: number },
): Promise<Device> {
  const devices = await queryRows<Device>(
    pool,
    `
      INSERT INTO devices (device_id, name, sample_rate)
      VALUES ($1, $2, $3)
      RETURNING ${DEVICE_COLUMNS}
    `,
    [input.deviceId, input.name, input.sampleRate],
  );
  const device = devices[0];

  if (device === undefined) {
    throw new Error('Device insert returned no row');
  }

  return device;
}

export async function listDevices(pool: Pool): Promise<Device[]> {
  return queryRows<Device>(
    pool,
    `
      SELECT ${DEVICE_COLUMNS}
      FROM devices
      ORDER BY last_seen DESC
    `,
  );
}

export async function getDevice(pool: Pool, deviceId: number): Promise<Device | null> {
  const devices = await queryRows<Device>(
    pool,
    `
      SELECT ${DEVICE_COLUMNS}
      FROM devices
      WHERE device_id = $1
    `,
    [deviceId],
  );

  return devices[0] ?? null;
}

export async function touchDevice(pool: Pool, deviceId: number): Promise<Device | null> {
  const devices = await queryRows<Device>(
    pool,
    `
      UPDATE devices
      SET last_seen = now(), status = 'online'
      WHERE device_id = $1
      RETURNING ${DEVICE_COLUMNS}
    `,
    [deviceId],
  );

  return devices[0] ?? null;
}

export async function listReadings(
  pool: Pool,
  deviceId: number,
  from: Date,
  to: Date,
): Promise<Reading[]> {
  return queryRows<Reading>(
    pool,
    `
      SELECT ${READING_COLUMNS}
      FROM readings
      WHERE device_id = $1 AND ts >= $2 AND ts < $3
      ORDER BY ts
      LIMIT ${READING_QUERY_LIMIT}
    `,
    [deviceId, from, to],
  );
}

export async function getLatestReading(pool: Pool, deviceId: number): Promise<Reading | null> {
  const readings = await queryRows<Reading>(
    pool,
    `
      SELECT ${READING_COLUMNS}
      FROM readings
      WHERE device_id = $1
      ORDER BY ts DESC
      LIMIT 1
    `,
    [deviceId],
  );

  return readings[0] ?? null;
}

export async function insertCommand(
  pool: Pool,
  input: { deviceId: number; type: CommandType; payload: CommandPayload },
): Promise<CommandRow> {
  const commands = await queryRows<CommandRow>(
    pool,
    `
      INSERT INTO commands (device_id, type, payload)
      VALUES ($1, $2, $3::jsonb)
      RETURNING ${COMMAND_COLUMNS}
    `,
    [input.deviceId, input.type, JSON.stringify(input.payload)],
  );
  const command = commands[0];

  if (command === undefined) {
    throw new Error('Command insert returned no row');
  }

  return command;
}

export async function takeNextPendingCommand(
  pool: Pool,
  deviceId: number,
): Promise<PendingCommand | null> {
  const commands = await queryRows<PendingCommand>(
    pool,
    `
      WITH next AS (
        SELECT id
        FROM commands
        WHERE device_id = $1 AND status = 'pending'
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE commands c
      SET status = 'delivered', delivered_at = now()
      FROM next
      WHERE c.id = next.id
      RETURNING c.id, c.type, c.payload
    `,
    [deviceId],
  );

  return commands[0] ?? null;
}

export async function recordCommandStatus(
  pool: Pool,
  input: {
    commandId: number;
    deviceId: number;
    status: Extract<CommandStatus, 'executed' | 'failed'>;
  },
): Promise<boolean> {
  const commands = await queryRows<{ id: number }>(
    pool,
    `
      UPDATE commands
      SET status = $2, executed_at = now()
      WHERE id = $1 AND device_id = $3 AND status = 'delivered'
      RETURNING id
    `,
    [input.commandId, input.status, input.deviceId],
  );

  return commands.length > 0;
}

export async function markAllDevicesOffline(pool: Pool): Promise<number> {
  const result = await pool.query(`
    UPDATE devices
    SET status = 'offline'
    WHERE status = 'online'
  `);

  return result.rowCount ?? 0;
}

export async function markDeviceOffline(pool: Pool, deviceId: number): Promise<boolean> {
  const devices = await queryRows<{ deviceId: number }>(
    pool,
    `
      UPDATE devices
      SET status = 'offline'
      WHERE device_id = $1 AND status = 'online'
      RETURNING device_id AS "deviceId"
    `,
    [deviceId],
  );

  return devices.length > 0;
}

export async function markDevicesOffline(pool: Pool, deviceIds: number[]): Promise<number[]> {
  if (deviceIds.length === 0) {
    return [];
  }

  const devices = await queryRows<{ deviceId: number }>(
    pool,
    `
      UPDATE devices
      SET status = 'offline'
      WHERE device_id = ANY($1::int[]) AND status = 'online'
      RETURNING device_id AS "deviceId"
    `,
    [deviceIds],
  );

  return devices.map((device) => device.deviceId);
}

export async function sweepPresence(pool: Pool, now: Date): Promise<number[]> {
  const devices = await queryRows<{ deviceId: number }>(
    pool,
    `
      UPDATE devices
      SET status = 'offline'
      WHERE status = 'online'
        AND last_seen < $1::timestamptz - make_interval(secs => GREATEST(3 * sample_rate, 15))
      RETURNING device_id AS "deviceId"
    `,
    [now],
  );

  return devices.map((device) => device.deviceId);
}

function hasDatabaseCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function isUniqueViolation(error: unknown): boolean {
  return hasDatabaseCode(error, '23505');
}

export function isForeignKeyViolation(error: unknown): boolean {
  return hasDatabaseCode(error, '23503');
}
