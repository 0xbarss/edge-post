import net from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enqueueCommand } from '../src/commands.js';
import { getDevice, getLatestReading, registerDevice } from '../src/db.js';
import {
  FRAME_SIZE,
  crc8,
  decodeFrame,
  encodeAcknowledgement,
  encodePoll,
  encodeReading,
} from '../src/frame.js';
import { Presence } from '../src/presence.js';
import { TcpServer } from '../src/tcp-server.js';
import { useTestDatabase } from './helpers/database.js';
import { silentLogger } from './helpers/logger.js';

const database = useTestDatabase();
const presence = new Presence(database.pool, silentLogger);

const DEVICE_ID = 4660;
const BASE_TIME_MS = 1_794_744_000_000;
const BASE_TIME_SECONDS = BASE_TIME_MS / 1000;

class TestClient {
  private buffer = Buffer.alloc(0);
  private readonly waiters: Array<{ size: number; resolve: (frame: Buffer) => void }> = [];

  constructor(private readonly socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.push(chunk);
    });
  }

  send(bytes: Uint8Array): void {
    this.socket.write(bytes);
  }

  next(size: number = FRAME_SIZE.command): Promise<Buffer> {
    return new Promise((resolve) => {
      this.waiters.push({ size, resolve });
      this.flush();
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.once('close', () => {
        resolve();
      });
      this.socket.end();
    });
  }

  private push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.flush();
  }

  private flush(): void {
    for (;;) {
      const waiter = this.waiters[0];

      if (waiter === undefined || this.buffer.length < waiter.size) {
        return;
      }

      const frame = this.buffer.subarray(0, waiter.size);
      this.buffer = this.buffer.subarray(waiter.size);
      this.waiters.shift();
      waiter.resolve(frame);
    }
  }
}

function connect(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const client = new TestClient(socket);

    socket.once('connect', () => {
      resolve(client);
    });
    socket.once('error', reject);
  });
}

async function waitFor(
  condition: () => Promise<boolean>,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for ${description}`);
}

function readingBytes(overrides: Partial<Parameters<typeof encodeReading>[0]> = {}): Buffer {
  return encodeReading({
    kind: 'reading',
    deviceId: DEVICE_ID,
    sequence: 7,
    timestamp: BASE_TIME_SECONDS,
    temperatureTenths: 234,
    gpioState: 0b0000_0101,
    sampleRate: 5,
    ...overrides,
  });
}

function acknowledgementBytes(deviceId: number, commandId: number, status: number): Buffer {
  const buffer = Buffer.alloc(FRAME_SIZE.ack);
  buffer.writeUInt16BE(0xee51, 0);
  buffer.writeUInt16BE(deviceId, 2);
  buffer.writeUInt32BE(commandId, 4);
  buffer.writeUInt8(status, 8);
  buffer.writeUInt8(crc8(buffer.subarray(0, 9)), 9);
  return buffer;
}

describe('tcp server', () => {
  let server: TcpServer | null = null;
  let port = 0;
  let clockMs = BASE_TIME_MS;

  beforeEach(async () => {
    clockMs = BASE_TIME_MS;
    server = new TcpServer({
      pool: database.pool,
      logger: silentLogger,
      presence,
      now: () => clockMs,
    });
    port = (await server.listen('127.0.0.1', 0)).port;
  });

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('persists a valid reading and marks the device online', async () => {
    const client = await connect(port);

    client.send(readingBytes());

    await waitFor(
      async () => (await getLatestReading(database.pool, DEVICE_ID)) !== null,
      'reading',
    );

    const reading = await getLatestReading(database.pool, DEVICE_ID);
    expect(reading).toMatchObject({
      deviceId: DEVICE_ID,
      sequence: 7,
      temperature: 23.4,
      gpioState: 5,
      sampleRate: 5,
    });

    const device = await getDevice(database.pool, DEVICE_ID);
    expect(device).toMatchObject({ deviceId: DEVICE_ID, status: 'online', sampleRate: 5 });

    await client.close();
  });

  it('answers a poll with the oldest queued command and marks it delivered', async () => {
    await registerDevice(database.pool, { deviceId: DEVICE_ID, name: 'bench', sampleRate: 5 });
    const command = await enqueueCommand(database.pool, {
      deviceId: DEVICE_ID,
      type: 'toggle_gpio',
      payload: { pin: 3, state: 1 },
    });
    const client = await connect(port);

    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));

    const frame = await client.next();

    expect(decodeFrame(frame)).toEqual({
      kind: 'command',
      deviceId: DEVICE_ID,
      commandId: command.id,
      type: 1,
      param1: 3,
      param2: 1,
    });

    const result = await database.pool.query<{ status: string }>(
      'SELECT status FROM commands WHERE id = $1',
      [command.id],
    );
    expect(result.rows[0]?.status).toBe('delivered');

    await client.close();
  });

  it('answers an empty queue with a no-command frame', async () => {
    await registerDevice(database.pool, { deviceId: DEVICE_ID, name: 'bench', sampleRate: 5 });
    const client = await connect(port);

    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));

    expect(decodeFrame(await client.next())).toEqual({
      kind: 'command',
      deviceId: DEVICE_ID,
      commandId: 0,
      type: 0,
      param1: 0,
      param2: 0,
    });

    await client.close();
  });

  it('records an executed acknowledgement', async () => {
    await registerDevice(database.pool, { deviceId: DEVICE_ID, name: 'bench', sampleRate: 5 });
    const command = await enqueueCommand(database.pool, {
      deviceId: DEVICE_ID,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });
    const client = await connect(port);

    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));
    const frame = decodeFrame(await client.next());
    expect(frame).toMatchObject({ kind: 'command', commandId: command.id, type: 2 });

    client.send(
      encodeAcknowledgement({ kind: 'ack', deviceId: DEVICE_ID, commandId: command.id, status: 0 }),
    );

    await waitFor(async () => {
      const result = await database.pool.query<{ status: string }>(
        'SELECT status FROM commands WHERE id = $1',
        [command.id],
      );
      return result.rows[0]?.status === 'executed';
    }, 'executed status');

    await client.close();
  });

  it('treats an unknown acknowledgement status as failed', async () => {
    await registerDevice(database.pool, { deviceId: DEVICE_ID, name: 'bench', sampleRate: 5 });
    const command = await enqueueCommand(database.pool, {
      deviceId: DEVICE_ID,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });
    const client = await connect(port);

    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));
    await client.next();

    client.send(acknowledgementBytes(DEVICE_ID, command.id, 3));

    await waitFor(async () => {
      const result = await database.pool.query<{ status: string }>(
        'SELECT status FROM commands WHERE id = $1',
        [command.id],
      );
      return result.rows[0]?.status === 'failed';
    }, 'failed status');

    await client.close();
  });

  it('drops a corrupted frame and keeps processing the stream', async () => {
    const client = await connect(port);
    const corrupted = readingBytes({ sequence: 1 });
    corrupted.writeUInt8(corrupted.readUInt8(14) ^ 0xff, 14);

    client.send(corrupted);
    client.send(readingBytes({ sequence: 2 }));

    await waitFor(async () => {
      const reading = await getLatestReading(database.pool, DEVICE_ID);
      return reading?.sequence === 2;
    }, 'valid reading after a corrupted frame');

    const result = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM readings',
    );
    expect(result.rows[0]?.count).toBe('1');

    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));
    expect((await client.next()).length).toBe(FRAME_SIZE.command);

    await client.close();
  });

  it('reassembles a frame split across reads', async () => {
    const client = await connect(port);
    const frame = readingBytes();

    client.send(frame.subarray(0, 6));
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.send(frame.subarray(6));

    await waitFor(
      async () => (await getLatestReading(database.pool, DEVICE_ID)) !== null,
      'reading',
    );

    expect((await getLatestReading(database.pool, DEVICE_ID))?.sequence).toBe(7);

    await client.close();
  });

  it('processes frames that arrive in one read', async () => {
    const client = await connect(port);

    client.send(
      Buffer.concat([
        readingBytes({ sequence: 8 }),
        encodePoll({ kind: 'poll', deviceId: DEVICE_ID }),
      ]),
    );

    await waitFor(async () => {
      const reading = await getLatestReading(database.pool, DEVICE_ID);
      return reading?.sequence === 8;
    }, 'reading');

    expect(decodeFrame(await client.next())).toMatchObject({ kind: 'command', type: 0 });

    await client.close();
  });

  it('throttles polls that arrive less than 500 ms apart', async () => {
    await registerDevice(database.pool, { deviceId: DEVICE_ID, name: 'bench', sampleRate: 5 });
    const first = await enqueueCommand(database.pool, {
      deviceId: DEVICE_ID,
      type: 'set_sample_rate',
      payload: { seconds: 10 },
    });
    const second = await enqueueCommand(database.pool, {
      deviceId: DEVICE_ID,
      type: 'toggle_gpio',
      payload: { pin: 1, state: 1 },
    });
    const client = await connect(port);

    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));
    expect(decodeFrame(await client.next())).toMatchObject({ commandId: first.id });

    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));
    expect(decodeFrame(await client.next())).toMatchObject({ commandId: 0, type: 0 });

    const pending = await database.pool.query<{ status: string }>(
      'SELECT status FROM commands WHERE id = $1',
      [second.id],
    );
    expect(pending.rows[0]?.status).toBe('pending');

    clockMs += 500;
    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));
    expect(decodeFrame(await client.next())).toMatchObject({ commandId: second.id });

    await client.close();
  });

  it('marks the device offline when the socket closes', async () => {
    const client = await connect(port);
    client.send(readingBytes());

    await waitFor(
      async () => (await getDevice(database.pool, DEVICE_ID))?.status === 'online',
      'online',
    );
    await client.close();

    await waitFor(
      async () => (await getDevice(database.pool, DEVICE_ID))?.status === 'offline',
      'offline',
    );
  });

  it('drops a reading for another device on an established connection', async () => {
    const client = await connect(port);

    client.send(readingBytes({ deviceId: DEVICE_ID }));
    await waitFor(async () => (await getDevice(database.pool, DEVICE_ID)) !== null, 'first device');

    client.send(readingBytes({ deviceId: 4661, sequence: 9 }));
    client.send(encodePoll({ kind: 'poll', deviceId: DEVICE_ID }));
    expect(decodeFrame(await client.next())).toMatchObject({ deviceId: DEVICE_ID });

    expect(await getDevice(database.pool, 4661)).toBeNull();
    expect((await getLatestReading(database.pool, DEVICE_ID))?.sequence).toBe(7);

    await client.close();
  });
});
