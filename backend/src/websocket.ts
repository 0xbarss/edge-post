import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocket, WebSocketServer, type RawData } from 'ws';

import type { Logger } from './logger.js';
import {
  MAX_DEVICE_ID,
  MIN_DEVICE_ID,
  type DeviceStatus,
  type LiveEventSink,
  type Reading,
} from './models.js';
import { hasExactKeys, isRecord } from './validation.js';

export const WEBSOCKET_PATH = '/ws';
export const MAX_WEBSOCKET_PAYLOAD_BYTES = 16 * 1024;
export const MAX_SUBSCRIPTION_DEVICES = 1024;

export interface ReadingEvent {
  event: 'reading';
  data: {
    deviceId: number;
    ts: string;
    temperature: number;
    gpioState: number;
  };
}

export interface DeviceStatusEvent {
  event: 'device:status';
  data: {
    deviceId: number;
    status: DeviceStatus;
  };
}

export interface ErrorEvent {
  event: 'error';
  data: {
    code: string;
    message: string;
  };
}

export type ServerEvent = ReadingEvent | DeviceStatusEvent | ErrorEvent;

export interface SubscribeEvent {
  event: 'subscribe';
  data: {
    deviceIds: number[];
  };
}

export type ClientEvent = SubscribeEvent;

export type ClientEventResult = { event: ClientEvent } | { code: string; message: string };

export function parseClientEvent(value: unknown): ClientEventResult {
  if (!isRecord(value) || !hasExactKeys(value, ['event', 'data'])) {
    return {
      code: 'invalid_message',
      message: 'Messages must contain only event and data',
    };
  }

  if (value.event !== 'subscribe') {
    return {
      code: 'unsupported_event',
      message: 'The only supported event is subscribe',
    };
  }

  if (!isRecord(value.data) || !hasExactKeys(value.data, ['deviceIds'])) {
    return {
      code: 'invalid_message',
      message: 'subscribe data requires only deviceIds',
    };
  }

  if (!Array.isArray(value.data.deviceIds)) {
    return {
      code: 'validation_error',
      message: 'deviceIds must be an array',
    };
  }

  const deviceIds: unknown[] = value.data.deviceIds;

  if (deviceIds.length > MAX_SUBSCRIPTION_DEVICES) {
    return {
      code: 'validation_error',
      message: `deviceIds must contain at most ${MAX_SUBSCRIPTION_DEVICES} entries`,
    };
  }

  const unique = new Set<number>();

  for (const deviceId of deviceIds) {
    if (
      typeof deviceId !== 'number' ||
      !Number.isInteger(deviceId) ||
      deviceId < MIN_DEVICE_ID ||
      deviceId > MAX_DEVICE_ID
    ) {
      return {
        code: 'validation_error',
        message: `deviceIds must contain integers between ${MIN_DEVICE_ID} and ${MAX_DEVICE_ID}`,
      };
    }

    unique.add(deviceId);
  }

  return { event: { event: 'subscribe', data: { deviceIds: [...unique] } } };
}

type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

function rawDataToText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }

  return Buffer.from(data).toString('utf8');
}

export class LiveFeed implements LiveEventSink {
  private readonly server: WebSocketServer;
  private readonly subscriptions = new Map<WebSocket, Set<number>>();
  private readonly upgrades = new Map<Server, UpgradeHandler>();

  constructor(private readonly logger: Logger) {
    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
    });

    this.server.on('connection', (socket: WebSocket) => {
      this.accept(socket);
    });

    this.server.on('error', (error: Error) => {
      this.logger.error({ err: error }, 'websocket server error');
    });
  }

  attach(server: Server): void {
    if (this.upgrades.has(server)) {
      return;
    }

    const handler: UpgradeHandler = (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    };

    this.upgrades.set(server, handler);
    server.on('upgrade', handler);
  }

  publishReading(reading: Reading): void {
    this.broadcast(reading.deviceId, {
      event: 'reading',
      data: {
        deviceId: reading.deviceId,
        ts: reading.ts.toISOString(),
        temperature: reading.temperature,
        gpioState: reading.gpioState,
      },
    });
  }

  publishStatus(deviceId: number, status: DeviceStatus): void {
    this.broadcast(deviceId, {
      event: 'device:status',
      data: { deviceId, status },
    });
  }

  async close(): Promise<void> {
    for (const [server, handler] of this.upgrades) {
      server.off('upgrade', handler);
    }

    this.upgrades.clear();

    for (const socket of this.subscriptions.keys()) {
      socket.terminate();
    }

    this.subscriptions.clear();

    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname !== WEBSOCKET_PATH) {
      socket.destroy();
      return;
    }

    this.server.handleUpgrade(request, socket, head, (webSocket) => {
      this.server.emit('connection', webSocket, request);
    });
  }

  private accept(socket: WebSocket): void {
    this.subscriptions.set(socket, new Set());
    this.logger.info({ clients: this.subscriptions.size }, 'websocket client connected');

    socket.on('message', (data: RawData) => {
      this.handleMessage(socket, data);
    });

    socket.on('close', () => {
      this.subscriptions.delete(socket);
      this.logger.info({ clients: this.subscriptions.size }, 'websocket client disconnected');
    });

    socket.on('error', (error: Error) => {
      this.logger.warn({ err: error }, 'websocket client error');
    });
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawDataToText(data));
    } catch {
      this.send(socket, {
        event: 'error',
        data: { code: 'invalid_json', message: 'Message must be valid JSON' },
      });
      return;
    }

    const result = parseClientEvent(parsed);

    if ('code' in result) {
      this.send(socket, { event: 'error', data: { code: result.code, message: result.message } });
      return;
    }

    this.subscriptions.set(socket, new Set(result.event.data.deviceIds));
  }

  private broadcast(deviceId: number, event: ServerEvent): void {
    const payload = JSON.stringify(event);

    for (const [socket, deviceIds] of this.subscriptions) {
      if (deviceIds.has(deviceId) && socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  private send(socket: WebSocket, event: ServerEvent): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }
}
