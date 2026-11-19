import type { AddressInfo } from 'node:net';
import net from 'node:net';

import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encodeReading } from '../src/frame.js';
import { Presence } from '../src/presence.js';
import { buildApp } from '../src/routes.js';
import { TcpServer } from '../src/tcp-server.js';
import { LiveFeed, type DeviceStatusEvent, type ReadingEvent } from '../src/websocket.js';
import { useTestDatabase } from './helpers/database.js';
import { silentLogger } from './helpers/logger.js';

const database = useTestDatabase();

const DEVICE_ID = 4660;
const SECOND_DEVICE_ID = 4661;
const BASE_TIME_MS = 1_794_744_000_000;
const BASE_TIME_SECONDS = BASE_TIME_MS / 1000;

interface EventShape {
  event: string;
  data: Record<string, unknown>;
}

class WsClient {
  private readonly queue: unknown[] = [];
  private readonly waiters: Array<{
    predicate: (message: unknown) => boolean;
    resolve: (message: unknown) => void;
  }> = [];

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (data: Buffer) => {
      this.receive(JSON.parse(data.toString()) as unknown);
    });
  }

  send(value: unknown): void {
    this.socket.send(typeof value === 'string' ? value : JSON.stringify(value));
  }

  next(predicate: (message: unknown) => boolean = () => true): Promise<unknown> {
    const index = this.queue.findIndex(predicate);

    if (index >= 0) {
      const [message] = this.queue.splice(index, 1);
      return Promise.resolve(message);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.waiters.indexOf(waiter);

        if (waiterIndex >= 0) {
          this.waiters.splice(waiterIndex, 1);
        }

        reject(new Error('Timed out waiting for a websocket message'));
      }, 5_000);

      const waiter = {
        predicate,
        resolve: (message: unknown) => {
          clearTimeout(timer);
          resolve(message);
        },
      };

      this.waiters.push(waiter);
    });
  }

  pending(): unknown[] {
    return [...this.queue];
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      this.socket.once('close', () => {
        resolve();
      });
      this.socket.close();
    });
  }

  private receive(message: unknown): void {
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));

    if (waiterIndex >= 0) {
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      waiter?.resolve(message);
      return;
    }

    this.queue.push(message);
  }
}

function eventOf(message: unknown): EventShape {
  const event = message as EventShape;

  if (typeof event.event !== 'string' || typeof event.data !== 'object' || event.data === null) {
    throw new Error('Unexpected websocket message shape');
  }

  return event;
}

function readingBytes(deviceId: number, sequence = 7): Buffer {
  return encodeReading({
    kind: 'reading',
    deviceId,
    sequence,
    timestamp: BASE_TIME_SECONDS,
    temperatureTenths: 234,
    gpioState: 0b0000_0101,
    sampleRate: 5,
  });
}

function connectTcp(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

function closeTcp(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }

    socket.once('close', () => {
      resolve();
    });
    socket.end();
  });
}

describe('websocket feed', () => {
  let app: FastifyInstance;
  let feed: LiveFeed;
  let tcpServer: TcpServer;
  let presence: Presence;
  let httpPort = 0;
  let tcpPort = 0;
  const clients: WsClient[] = [];
  const sockets: net.Socket[] = [];

  beforeEach(async () => {
    feed = new LiveFeed(silentLogger);
    presence = new Presence(database.pool, silentLogger, feed);
    tcpServer = new TcpServer({
      pool: database.pool,
      logger: silentLogger,
      presence,
      live: feed,
      now: () => BASE_TIME_MS,
    });
    app = buildApp({ pool: database.pool, logger: silentLogger });
    feed.attach(app.server);

    const tcpAddress = await tcpServer.listen('127.0.0.1', 0);
    await app.listen({ host: '127.0.0.1', port: 0 });

    const address = app.server.address() as AddressInfo;
    httpPort = address.port;
    tcpPort = tcpAddress.port;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close();
    }

    for (const socket of sockets.splice(0)) {
      socket.destroy();
    }

    await tick();
    await feed.close();
    await tcpServer.close();
    await app.close();
  });

  async function openSocket(): Promise<WsClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
    const client = new WsClient(socket);
    clients.push(client);

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => {
        resolve();
      });
      socket.once('error', reject);
    });

    return client;
  }

  async function subscribe(client: WsClient, deviceIds: number[]): Promise<void> {
    client.send({ event: 'subscribe', data: { deviceIds } });
    client.send({ event: 'probe', data: {} });
    const error = eventOf(
      await client.next(
        (message) =>
          eventOf(message).event === 'error' && eventOf(message).data.code === 'unsupported_event',
      ),
    );

    expect(error.data).toMatchObject({ code: 'unsupported_event' });
  }

  async function openTcp(): Promise<net.Socket> {
    const socket = await connectTcp(tcpPort);
    sockets.push(socket);
    return socket;
  }

  it('broadcasts a reading and the first online transition to a subscriber', async () => {
    const client = await openSocket();
    await subscribe(client, [DEVICE_ID]);

    const socket = await openTcp();
    socket.write(readingBytes(DEVICE_ID));

    const status = eventOf(
      await client.next((message) => eventOf(message).event === 'device:status'),
    ) as unknown as DeviceStatusEvent;

    expect(status.data).toEqual({ deviceId: DEVICE_ID, status: 'online' });

    const reading = eventOf(
      await client.next((message) => eventOf(message).event === 'reading'),
    ) as unknown as ReadingEvent;

    expect(reading.data).toEqual({
      deviceId: DEVICE_ID,
      ts: new Date(BASE_TIME_SECONDS * 1000).toISOString(),
      temperature: 23.4,
      gpioState: 5,
    });
  });

  it('does not emit another online transition while the device stays online', async () => {
    const client = await openSocket();
    await subscribe(client, [DEVICE_ID]);

    const socket = await openTcp();
    socket.write(readingBytes(DEVICE_ID, 1));
    await client.next((message) => eventOf(message).event === 'device:status');
    await client.next((message) => eventOf(message).event === 'reading');

    socket.write(readingBytes(DEVICE_ID, 2));
    await client.next((message) => eventOf(message).event === 'reading');
    await tick();

    const statusEvents = client
      .pending()
      .filter((message) => eventOf(message).event === 'device:status');
    expect(statusEvents).toHaveLength(0);
  });

  it('reaches every subscribed client', async () => {
    const first = await openSocket();
    const second = await openSocket();
    await subscribe(first, [DEVICE_ID]);
    await subscribe(second, [DEVICE_ID]);

    const socket = await openTcp();
    socket.write(readingBytes(DEVICE_ID));

    const firstReading = eventOf(
      await first.next((message) => eventOf(message).event === 'reading'),
    );
    const secondReading = eventOf(
      await second.next((message) => eventOf(message).event === 'reading'),
    );

    expect(firstReading.data).toEqual(secondReading.data);
  });

  it('filters readings and status by subscription', async () => {
    const first = await openSocket();
    const second = await openSocket();
    await subscribe(first, [DEVICE_ID]);
    await subscribe(second, [SECOND_DEVICE_ID]);

    const firstSocket = await openTcp();
    const secondSocket = await openTcp();

    firstSocket.write(readingBytes(DEVICE_ID));
    await first.next((message) => eventOf(message).event === 'reading');

    secondSocket.write(readingBytes(SECOND_DEVICE_ID));
    await second.next((message) => eventOf(message).event === 'reading');
    await tick();

    expect(
      first
        .pending()
        .map(eventOf)
        .map((event) => event.data.deviceId),
    ).not.toContain(SECOND_DEVICE_ID);
    expect(
      second
        .pending()
        .map(eventOf)
        .map((event) => event.data.deviceId),
    ).not.toContain(DEVICE_ID);
  });

  it('answers malformed messages with an error and keeps the socket usable', async () => {
    const client = await openSocket();

    client.send('{');
    expect(
      eventOf(await client.next((message) => eventOf(message).event === 'error')),
    ).toMatchObject({ data: { code: 'invalid_json' } });

    client.send({ event: 'unsubscribe', data: { deviceIds: [] } });
    expect(
      eventOf(await client.next((message) => eventOf(message).event === 'error')),
    ).toMatchObject({ data: { code: 'unsupported_event' } });

    client.send({ event: 'subscribe', data: { deviceIds: [0] } });
    expect(
      eventOf(await client.next((message) => eventOf(message).event === 'error')),
    ).toMatchObject({ data: { code: 'validation_error' } });

    await subscribe(client, [DEVICE_ID]);
    const socket = await openTcp();
    socket.write(readingBytes(DEVICE_ID));

    expect(
      eventOf(await client.next((message) => eventOf(message).event === 'reading')).data,
    ).toMatchObject({ deviceId: DEVICE_ID });
  });

  it('broadcasts the offline transition when the device socket closes', async () => {
    const client = await openSocket();
    await subscribe(client, [DEVICE_ID]);

    const socket = await openTcp();
    socket.write(readingBytes(DEVICE_ID));
    await client.next((message) => eventOf(message).event === 'reading');
    await closeTcp(socket);

    const status = eventOf(
      await client.next(
        (message) =>
          eventOf(message).event === 'device:status' && eventOf(message).data.status === 'offline',
      ),
    ) as unknown as DeviceStatusEvent;

    expect(status.data).toEqual({ deviceId: DEVICE_ID, status: 'offline' });
  });

  it('broadcasts the offline transition when the presence sweep expires a device', async () => {
    const client = await openSocket();
    await subscribe(client, [DEVICE_ID]);

    const socket = await openTcp();
    socket.write(readingBytes(DEVICE_ID));
    await client.next((message) => eventOf(message).event === 'reading');

    await database.pool.query(
      "UPDATE devices SET last_seen = now() - interval '16 seconds' WHERE device_id = $1",
      [DEVICE_ID],
    );

    expect(await presence.sweepNow()).toEqual([DEVICE_ID]);

    const status = eventOf(
      await client.next(
        (message) =>
          eventOf(message).event === 'device:status' && eventOf(message).data.status === 'offline',
      ),
    );

    expect(status.data).toEqual({ deviceId: DEVICE_ID, status: 'offline' });
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}
