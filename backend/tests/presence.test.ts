import { describe, expect, it } from 'vitest';

import { registerDevice, touchDevice } from '../src/db.js';
import { Presence } from '../src/presence.js';
import { useTestDatabase } from './helpers/database.js';
import { silentLogger } from './helpers/logger.js';

const database = useTestDatabase();
const presence = new Presence(database.pool, silentLogger);

async function setLastSeen(deviceId: number, secondsAgo: number): Promise<void> {
  await database.pool.query(
    'UPDATE devices SET last_seen = now() - make_interval(secs => $2) WHERE device_id = $1',
    [deviceId, secondsAgo],
  );
}

describe('presence', () => {
  it('marks every online device offline on startup', async () => {
    await registerDevice(database.pool, { deviceId: 1, name: 'one', sampleRate: 5 });
    await registerDevice(database.pool, { deviceId: 2, name: 'two', sampleRate: 5 });
    await touchDevice(database.pool, 1);
    await touchDevice(database.pool, 2);

    expect(await presence.resetOnStartup()).toBe(2);

    const result = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM devices WHERE status = 'online'",
    );
    expect(result.rows[0]?.count).toBe('0');
  });

  it('marks only the requested devices offline', async () => {
    await registerDevice(database.pool, { deviceId: 1, name: 'one', sampleRate: 5 });
    await registerDevice(database.pool, { deviceId: 2, name: 'two', sampleRate: 5 });
    await touchDevice(database.pool, 1);
    await touchDevice(database.pool, 2);

    expect(await presence.markOffline([1, 1])).toEqual([1]);
    expect(await presence.markOffline([1])).toEqual([]);

    const result = await database.pool.query<{ device_id: number; status: string }>(
      'SELECT device_id, status FROM devices ORDER BY device_id',
    );
    expect(result.rows).toEqual([
      { device_id: 1, status: 'offline' },
      { device_id: 2, status: 'online' },
    ]);
  });

  it('sweeps a device after the 15 second floor', async () => {
    await registerDevice(database.pool, { deviceId: 1, name: 'slow', sampleRate: 5 });
    await touchDevice(database.pool, 1);
    await setLastSeen(1, 16);

    expect(await presence.sweepNow()).toEqual([1]);
  });

  it('keeps a device online before the floor', async () => {
    await registerDevice(database.pool, { deviceId: 1, name: 'slow', sampleRate: 5 });
    await touchDevice(database.pool, 1);
    await setLastSeen(1, 14);

    expect(await presence.sweepNow()).toEqual([]);
  });

  it('uses three sample intervals above the floor', async () => {
    await registerDevice(database.pool, { deviceId: 1, name: 'fast', sampleRate: 20 });
    await touchDevice(database.pool, 1);
    await setLastSeen(1, 59);

    expect(await presence.sweepNow()).toEqual([]);

    await touchDevice(database.pool, 1);
    await setLastSeen(1, 61);

    expect(await presence.sweepNow()).toEqual([1]);
  });
});
