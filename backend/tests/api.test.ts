import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BoardProfile } from '../src/board-profile.js';
import { ingestReading } from '../src/db.js';
import { buildApp } from '../src/routes.js';
import { useTestDatabase } from './helpers/database.js';
import { silentLogger } from './helpers/logger.js';

const database = useTestDatabase();

interface DevicePayload {
  deviceId: number;
  name: string;
  firstSeen: string;
  lastSeen: string;
  status: 'online' | 'offline';
  sampleRate: number;
}

interface ReadingPayload {
  id: string;
  deviceId: number;
  sequence: number;
  ts: string;
  receivedAt: string;
  temperature: number;
  gpioState: number;
  sampleRate: number;
}

interface CommandPayload {
  id: number;
  deviceId: number;
  type: string;
  payload: unknown;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  executedAt: string | null;
}

interface ErrorPayload {
  error: { code: string; message: string };
}

interface DataPayload<T> {
  data: T;
}

const DEVICE = { deviceId: 4660, name: 'Bench node', sampleRate: 5 };

const BOARD: BoardProfile = {
  name: 'bench-board',
  source: 'boards/bench-board/bench-board.ioc',
  mcu: {
    name: 'STM32G071CBTx',
    cpn: null,
    family: 'STM32G0',
    package: 'LQFP48',
  },
  firmwarePackage: null,
  clock: { sysclkHz: 64000000, hclkHz: 64000000, rtcSource: null },
  peripherals: ['ADC1', 'SPI1'],
  pins: [],
  groups: { adc: [], uart: [], spi: [], i2c: [], outputs: [], inputs: [] },
  roles: {
    temperature: null,
    networkSpi: null,
    networkUart: null,
    networkCsPin: null,
    outputs: [],
  },
};

describe('rest api', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({ pool: database.pool, logger: silentLogger, boards: [BOARD] });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerDevice(input: Record<string, unknown> = DEVICE): Promise<DevicePayload> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices',
      payload: input,
    });

    expect(response.statusCode).toBe(201);
    return response.json<DataPayload<DevicePayload>>().data;
  }

  it('returns the board catalog', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/boards' });

    expect(response.statusCode).toBe(200);
    expect(response.json<DataPayload<BoardProfile[]>>().data).toEqual([BOARD]);
  });

  it('registers a device and returns it in the registry', async () => {
    const created = await registerDevice();

    expect(created).toMatchObject({
      deviceId: 4660,
      name: 'Bench node',
      status: 'offline',
      sampleRate: 5,
    });

    const list = await app.inject({ method: 'GET', url: '/api/v1/devices' });
    expect(list.statusCode).toBe(200);
    expect(list.json<DataPayload<DevicePayload[]>>().data).toEqual([created]);
  });

  it('rejects a duplicate device with a conflict envelope', async () => {
    await registerDevice();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices',
      payload: DEVICE,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorPayload>().error).toMatchObject({ code: 'conflict' });
  });

  it('validates the device body at the boundary', async () => {
    const invalidBodies = [
      { ...DEVICE, deviceId: 0 },
      { ...DEVICE, sampleRate: 256 },
      { ...DEVICE, name: '   ' },
      { ...DEVICE, name: 'x'.repeat(101) },
      { ...DEVICE, extra: true },
      { name: 'missing id', sampleRate: 5 },
    ];

    for (const payload of invalidBodies) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/devices', payload });

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorPayload>().error.code).toBe('validation_error');
    }
  });

  it('rejects a body that is not a JSON object', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { 'content-type': 'application/json' },
      payload: '[]',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorPayload>().error.code).toBe('validation_error');
  });

  it('lists devices by most recent activity', async () => {
    await registerDevice({ deviceId: 1, name: 'first', sampleRate: 5 });
    await registerDevice({ deviceId: 2, name: 'second', sampleRate: 5 });
    await database.pool.query(
      "UPDATE devices SET last_seen = now() - interval '1 hour' WHERE device_id = 2",
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/devices' });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<DataPayload<DevicePayload[]>>().data.map((device) => device.deviceId),
    ).toEqual([1, 2]);
  });

  it('returns device detail with the latest reading', async () => {
    await registerDevice();
    await ingestReading(database.pool, {
      deviceId: 4660,
      sequence: 7,
      timestamp: 1_794_744_000,
      temperatureTenths: 234,
      gpioState: 5,
      sampleRate: 5,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/devices/4660' });

    expect(response.statusCode).toBe(200);
    const body =
      response.json<DataPayload<{ device: DevicePayload; latestReading: ReadingPayload | null }>>();
    expect(body.data.device).toMatchObject({ deviceId: 4660, status: 'online' });
    expect(body.data.latestReading).toMatchObject({ sequence: 7, temperature: 23.4 });
  });

  it('rejects an unknown device and a malformed device id', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/v1/devices/999' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ErrorPayload>().error.code).toBe('not_found');

    const malformed = await app.inject({ method: 'GET', url: '/api/v1/devices/abc' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<ErrorPayload>().error.code).toBe('validation_error');
  });

  it('returns readings in a half-open time range', async () => {
    await registerDevice();
    for (const [sequence, timestamp] of [
      [1, 100],
      [2, 200],
      [3, 300],
    ] as const) {
      await ingestReading(database.pool, {
        deviceId: 4660,
        sequence,
        timestamp,
        temperatureTenths: 200,
        gpioState: 0,
        sampleRate: 5,
      });
    }

    const query = new URLSearchParams({
      deviceId: '4660',
      from: new Date(100_000).toISOString(),
      to: new Date(300_000).toISOString(),
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/readings?${query.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    const readings = response.json<DataPayload<ReadingPayload[]>>().data;
    expect(readings.map((reading) => reading.sequence)).toEqual([1, 2]);
  });

  it('validates the history query', async () => {
    await registerDevice();

    const missingDevice = await app.inject({ method: 'GET', url: '/api/v1/readings' });
    expect(missingDevice.statusCode).toBe(400);

    const reversed = await app.inject({
      method: 'GET',
      url: '/api/v1/readings?deviceId=4660&from=2026-11-16T00:00:00Z&to=2026-11-15T00:00:00Z',
    });
    expect(reversed.statusCode).toBe(400);

    const tooWide = await app.inject({
      method: 'GET',
      url: '/api/v1/readings?deviceId=4660&from=2026-11-01T00:00:00Z&to=2026-11-16T00:00:00Z',
    });
    expect(tooWide.statusCode).toBe(400);

    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/readings?deviceId=4660&from=yesterday&to=today',
    });
    expect(malformed.statusCode).toBe(400);

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/readings?deviceId=999&from=2026-11-15T00:00:00Z&to=2026-11-15T01:00:00Z',
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('enqueues a validated command', async () => {
    await registerDevice();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/commands',
      payload: { deviceId: 4660, type: 'toggle_gpio', payload: { pin: 3, state: 1 } },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<DataPayload<CommandPayload>>().data).toMatchObject({
      deviceId: 4660,
      type: 'toggle_gpio',
      payload: { pin: 3, state: 1 },
      status: 'pending',
    });
  });

  it('rejects an invalid command before insert', async () => {
    await registerDevice();

    const invalidPayload = await app.inject({
      method: 'POST',
      url: '/api/v1/commands',
      payload: { deviceId: 4660, type: 'toggle_gpio', payload: { pin: 9, state: 1 } },
    });
    expect(invalidPayload.statusCode).toBe(400);
    expect(invalidPayload.json<ErrorPayload>().error.code).toBe('validation_error');

    const unknownType = await app.inject({
      method: 'POST',
      url: '/api/v1/commands',
      payload: { deviceId: 4660, type: 'reboot', payload: {} },
    });
    expect(unknownType.statusCode).toBe(400);

    const unknownDevice = await app.inject({
      method: 'POST',
      url: '/api/v1/commands',
      payload: { deviceId: 999, type: 'set_sample_rate', payload: { seconds: 10 } },
    });
    expect(unknownDevice.statusCode).toBe(404);
    expect(unknownDevice.json<ErrorPayload>().error.code).toBe('not_found');
  });

  it('returns the error envelope for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/unknown' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorPayload>()).toEqual({
      error: { code: 'not_found', message: 'Route not found' },
    });
  });
});
