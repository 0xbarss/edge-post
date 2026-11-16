import { describe, expect, it } from 'vitest';

import {
  getDevice,
  getLatestReading,
  ingestReading,
  listDevices,
  listReadings,
  registerDevice,
} from '../src/db.js';
import type { ReadingInput } from '../src/models.js';
import { useTestDatabase } from './helpers/database.js';

const database = useTestDatabase();

const sample: ReadingInput = {
  deviceId: 4660,
  sequence: 7,
  timestamp: 1_794_744_000,
  temperatureTenths: 234,
  gpioState: 0b0000_0101,
  sampleRate: 5,
};

describe('reading ingestion', () => {
  it('registers an unknown device and stores the reading', async () => {
    const { device, reading } = await ingestReading(database.pool, sample);

    expect(device).toMatchObject({
      deviceId: 4660,
      name: 'device-4660',
      status: 'online',
      sampleRate: 5,
    });
    expect(reading).toMatchObject({
      deviceId: 4660,
      sequence: 7,
      temperature: 23.4,
      gpioState: 5,
      sampleRate: 5,
    });
    expect(reading.ts.getTime()).toBe(1_794_744_000_000);
    expect(reading.receivedAt.getTime()).toBeGreaterThan(0);
  });

  it('preserves an existing device name and updates its sample rate', async () => {
    await registerDevice(database.pool, {
      deviceId: 4660,
      name: 'Bench node',
      sampleRate: 5,
    });

    const { device } = await ingestReading(database.pool, { ...sample, sampleRate: 9 });

    expect(device.name).toBe('Bench node');
    expect(device.sampleRate).toBe(9);
    expect(device.status).toBe('online');
  });

  it('stores duplicate readings after a reconnect', async () => {
    await ingestReading(database.pool, sample);
    await ingestReading(database.pool, sample);

    const readings = await listReadings(
      database.pool,
      4660,
      new Date(1_794_700_000_000),
      new Date(1_794_800_000_000),
    );

    expect(readings).toHaveLength(2);
    expect(readings.map((reading) => reading.sequence)).toEqual([7, 7]);
  });

  it('rolls the device upsert back when the reading is rejected', async () => {
    await expect(
      ingestReading(database.pool, { ...sample, temperatureTenths: 1501 }),
    ).rejects.toThrow();

    expect(await getDevice(database.pool, 4660)).toBeNull();

    const counts = await database.pool.query<{ readings: string }>(
      'SELECT count(*)::text AS readings FROM readings',
    );
    expect(counts.rows[0]?.readings).toBe('0');
  });

  it('applies the database band to temperature', async () => {
    await expect(
      ingestReading(database.pool, { ...sample, temperatureTenths: -1001 }),
    ).rejects.toThrow();
  });
});

describe('device and reading queries', () => {
  it('lists devices by most recent activity', async () => {
    await registerDevice(database.pool, { deviceId: 1, name: 'first', sampleRate: 5 });
    await registerDevice(database.pool, { deviceId: 2, name: 'second', sampleRate: 5 });
    await database.pool.query(
      "UPDATE devices SET last_seen = now() - interval '1 hour' WHERE device_id = 2",
    );

    const devices = await listDevices(database.pool);

    expect(devices.map((device) => device.deviceId)).toEqual([1, 2]);
  });

  it('returns the latest reading by device time', async () => {
    await ingestReading(database.pool, { ...sample, timestamp: 1_794_744_000 });
    await ingestReading(database.pool, {
      ...sample,
      sequence: 8,
      timestamp: 1_794_744_060,
      temperatureTenths: 235,
    });

    const latest = await getLatestReading(database.pool, 4660);

    expect(latest?.sequence).toBe(8);
    expect(latest?.temperature).toBe(23.5);
  });

  it('uses a half-open time range', async () => {
    await ingestReading(database.pool, { ...sample, timestamp: 100 });
    await ingestReading(database.pool, { ...sample, sequence: 8, timestamp: 200 });

    const readings = await listReadings(database.pool, 4660, new Date(100_000), new Date(200_000));

    expect(readings.map((reading) => reading.sequence)).toEqual([7]);
  });

  it('returns no latest reading for a device without history', async () => {
    await registerDevice(database.pool, { deviceId: 1, name: 'empty', sampleRate: 5 });

    expect(await getLatestReading(database.pool, 1)).toBeNull();
  });
});
