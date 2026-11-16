import { describe, expect, it } from 'vitest';

import { acknowledgeCommand, dequeueCommand, enqueueCommand } from '../src/commands.js';
import { isForeignKeyViolation, registerDevice } from '../src/db.js';
import { ValidationError } from '../src/errors.js';
import { useTestDatabase } from './helpers/database.js';

const database = useTestDatabase();

async function register(deviceId = 4660): Promise<void> {
  await registerDevice(database.pool, {
    deviceId,
    name: `device-${deviceId}`,
    sampleRate: 5,
  });
}

async function commandStatus(commandId: number): Promise<string | undefined> {
  const result = await database.pool.query<{ status: string }>(
    'SELECT status FROM commands WHERE id = $1',
    [commandId],
  );
  return result.rows[0]?.status;
}

describe('command queue', () => {
  it('enqueues a validated command', async () => {
    await register();

    const command = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'toggle_gpio',
      payload: { pin: 3, state: 1 },
    });

    expect(command).toMatchObject({
      deviceId: 4660,
      type: 'toggle_gpio',
      payload: { pin: 3, state: 1 },
      status: 'pending',
    });
    expect(command.id).toBeGreaterThan(0);
  });

  it('rejects an invalid payload before insert', async () => {
    await register();

    await expect(
      enqueueCommand(database.pool, {
        deviceId: 4660,
        type: 'toggle_gpio',
        payload: { pin: 9, state: 1 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const result = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM commands',
    );
    expect(result.rows[0]?.count).toBe('0');
  });

  it('rejects a command for an unknown device', async () => {
    const error = await enqueueCommand(database.pool, {
      deviceId: 999,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    }).catch((caught: unknown) => caught);

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it('delivers the oldest pending command and marks it delivered', async () => {
    await register();
    const first = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'toggle_gpio',
      payload: { pin: 3, state: 1 },
    });
    const second = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });

    const frame = await dequeueCommand(database.pool, 4660);

    expect(frame).toEqual({
      kind: 'command',
      deviceId: 4660,
      commandId: first.id,
      type: 1,
      param1: 3,
      param2: 1,
    });
    expect(await commandStatus(first.id)).toBe('delivered');
    expect(await commandStatus(second.id)).toBe('pending');
  });

  it('returns an empty command frame when the queue is empty', async () => {
    await register();

    expect(await dequeueCommand(database.pool, 4660)).toEqual({
      kind: 'command',
      deviceId: 4660,
      commandId: 0,
      type: 0,
      param1: 0,
      param2: 0,
    });
  });

  it('takes a single command when two consumers dequeue concurrently', async () => {
    await register();
    await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });

    const [first, second] = await Promise.all([
      dequeueCommand(database.pool, 4660),
      dequeueCommand(database.pool, 4660),
    ]);

    const types = [first.type, second.type].sort();
    expect(types).toEqual([0, 2]);
  });

  it('marks a delivered command executed', async () => {
    await register();
    const command = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });
    await dequeueCommand(database.pool, 4660);

    expect(await acknowledgeCommand(database.pool, 4660, command.id, 0)).toBe(true);
    expect(await commandStatus(command.id)).toBe('executed');

    const executed = await database.pool.query<{ executed_at: Date | null }>(
      'SELECT executed_at FROM commands WHERE id = $1',
      [command.id],
    );
    expect(executed.rows[0]?.executed_at).not.toBeNull();
  });

  it('marks rejected and unsupported acknowledgements failed', async () => {
    await register();
    const rejected = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'toggle_gpio',
      payload: { pin: 3, state: 1 },
    });
    const unsupported = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });
    await dequeueCommand(database.pool, 4660);
    await dequeueCommand(database.pool, 4660);

    expect(await acknowledgeCommand(database.pool, 4660, rejected.id, 1)).toBe(true);
    expect(await acknowledgeCommand(database.pool, 4660, unsupported.id, 2)).toBe(true);
    expect(await commandStatus(rejected.id)).toBe('failed');
    expect(await commandStatus(unsupported.id)).toBe('failed');
  });

  it('ignores a duplicate acknowledgement', async () => {
    await register();
    const command = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });
    await dequeueCommand(database.pool, 4660);
    await acknowledgeCommand(database.pool, 4660, command.id, 0);

    expect(await acknowledgeCommand(database.pool, 4660, command.id, 0)).toBe(false);
  });

  it('ignores an acknowledgement from another device', async () => {
    await register(4660);
    await register(4661);
    const command = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });
    await dequeueCommand(database.pool, 4660);

    expect(await acknowledgeCommand(database.pool, 4661, command.id, 0)).toBe(false);
    expect(await commandStatus(command.id)).toBe('delivered');
  });

  it('ignores an acknowledgement for a pending command', async () => {
    await register();
    const command = await enqueueCommand(database.pool, {
      deviceId: 4660,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });

    expect(await acknowledgeCommand(database.pool, 4660, command.id, 0)).toBe(false);
    expect(await commandStatus(command.id)).toBe('pending');
  });
});
