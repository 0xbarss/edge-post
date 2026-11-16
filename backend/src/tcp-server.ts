import net from 'node:net';
import type { Socket } from 'node:net';

import type { Pool } from 'pg';

import { acknowledgeCommand, dequeueCommand, emptyCommandFrame } from './commands.js';
import { ingestReading } from './db.js';
import {
  FrameError,
  FrameReader,
  encodeCommand,
  validateFrame,
  type AckStatus,
  type CommandFrame,
  type DecodedFrame,
  type FrameReadResult,
} from './frame.js';
import type { Logger } from './logger.js';
import type { Presence } from './presence.js';

export const MIN_POLL_INTERVAL_MS = 500;
export const MIN_SOCKET_IDLE_TIMEOUT_MS = 60_000;
export const SOCKET_SAMPLE_MULTIPLIER = 4;
export const CLOCK_SKEW_WARNING_SECONDS = 60 * 60;

export function socketIdleTimeoutMs(sampleRate: number | null): number {
  if (sampleRate === null) {
    return MIN_SOCKET_IDLE_TIMEOUT_MS;
  }

  return Math.max(SOCKET_SAMPLE_MULTIPLIER * sampleRate * 1000, MIN_SOCKET_IDLE_TIMEOUT_MS);
}

export interface TcpServerOptions {
  pool: Pool;
  logger: Logger;
  presence: Presence;
  now?: () => number;
}

interface ConnectionState {
  deviceId: number | null;
  reader: FrameReader;
  lastPollAtMs: number | null;
  closed: boolean;
  queue: Promise<void>;
}

function describeSocket(socket: Socket): string {
  return `${socket.remoteAddress ?? 'unknown'}:${String(socket.remotePort ?? 0)}`;
}

function errorCodeFor(error: unknown): string {
  return error instanceof FrameError ? error.code : 'unexpected';
}

export class TcpServer {
  private readonly server: net.Server;
  private readonly sockets = new Set<Socket>();
  private readonly connections = new Map<number, Socket>();
  private readonly states = new WeakMap<Socket, ConnectionState>();
  private readonly closingTasks = new Set<Promise<void>>();
  private readonly now: () => number;

  constructor(private readonly options: TcpServerOptions) {
    this.now = options.now ?? Date.now;
    this.server = net.createServer((socket) => {
      this.accept(socket);
    });
    this.server.on('error', (error: Error) => {
      this.options.logger.error({ err: error }, 'tcp server error');
    });
  }

  async listen(host: string, port: number): Promise<net.AddressInfo> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off('error', onError);
        resolve();
      };

      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(port, host);
    });

    const address = this.server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('TCP server did not bind to a network address');
    }

    this.options.logger.info({ host: address.address, port: address.port }, 'tcp server listening');
    return address;
  }

  async close(): Promise<void> {
    if (!this.server.listening) {
      return;
    }

    const closed = new Promise<void>((resolve) => {
      this.server.once('close', () => {
        resolve();
      });
    });

    this.server.close();

    for (const socket of this.sockets) {
      socket.destroy();
    }

    await closed;

    if (this.closingTasks.size > 0) {
      await Promise.allSettled([...this.closingTasks]);
    }
  }

  private accept(socket: Socket): void {
    const state: ConnectionState = {
      deviceId: null,
      reader: new FrameReader(),
      lastPollAtMs: null,
      closed: false,
      queue: Promise.resolve(),
    };

    this.sockets.add(socket);
    this.states.set(socket, state);

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.setTimeout(socketIdleTimeoutMs(null));

    socket.on('data', (chunk: Buffer) => {
      this.enqueue(state, () => this.processChunk(socket, state, chunk));
    });

    socket.on('timeout', () => {
      this.options.logger.warn(
        { remote: describeSocket(socket) },
        'closing idle device connection',
      );
      socket.destroy();
    });

    socket.on('error', (error: Error) => {
      this.options.logger.warn(
        { err: error, remote: describeSocket(socket) },
        'device connection error',
      );
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
      state.closed = true;
      this.track(this.handleClose(socket, state));
    });

    this.options.logger.info({ remote: describeSocket(socket) }, 'device connected');
  }

  private enqueue(state: ConnectionState, task: () => Promise<void>): void {
    state.queue = state.queue.then(task).catch((error: unknown) => {
      this.options.logger.error({ err: error }, 'device frame processing failed');
    });
  }

  private track(task: Promise<void>): void {
    this.closingTasks.add(task);
    void task
      .catch((error: unknown) => {
        this.options.logger.error({ err: error }, 'failed to finish a connection close');
      })
      .finally(() => {
        this.closingTasks.delete(task);
      });
  }

  private async processChunk(socket: Socket, state: ConnectionState, chunk: Buffer): Promise<void> {
    if (state.closed || socket.destroyed) {
      return;
    }

    const results = state.reader.push(chunk);

    for (const result of results) {
      await this.handleResult(socket, state, result);
    }
  }

  private async handleResult(
    socket: Socket,
    state: ConnectionState,
    result: FrameReadResult,
  ): Promise<void> {
    if ('error' in result) {
      this.options.logger.warn(
        { code: result.error.code, remote: describeSocket(socket) },
        'dropped invalid frame',
      );
      return;
    }

    await this.dispatch(socket, state, result.frame);
  }

  private async dispatch(
    socket: Socket,
    state: ConnectionState,
    frame: DecodedFrame,
  ): Promise<void> {
    if (frame.kind === 'command') {
      this.options.logger.warn(
        { deviceId: frame.deviceId, remote: describeSocket(socket) },
        'ignored command frame received from a device',
      );
      return;
    }

    const nowMs = this.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    let ackStatusOverride: AckStatus | null = null;

    try {
      validateFrame(frame, nowSeconds);
    } catch (error) {
      const rawStatus = frame.kind === 'ack' ? (frame.status as number) : null;

      if (frame.kind === 'ack' && rawStatus !== null && errorCodeFor(error) === 'ack-status') {
        this.options.logger.warn(
          { deviceId: frame.deviceId, commandId: frame.commandId, status: rawStatus },
          'unknown acknowledgement status treated as failed',
        );
        ackStatusOverride = 1;
      } else {
        this.options.logger.warn(
          { code: errorCodeFor(error), remote: describeSocket(socket) },
          'dropped invalid frame',
        );
        return;
      }
    }

    if (!this.bindDevice(socket, state, frame.deviceId)) {
      return;
    }

    switch (frame.kind) {
      case 'reading':
        await this.handleReading(socket, state, frame);
        return;
      case 'poll':
        await this.handlePoll(socket, state, frame.deviceId, nowMs);
        return;
      case 'ack':
        await this.handleAcknowledgement(
          socket,
          frame.deviceId,
          frame.commandId,
          ackStatusOverride ?? frame.status,
        );
    }
  }

  private bindDevice(socket: Socket, state: ConnectionState, deviceId: number): boolean {
    if (state.deviceId === null) {
      const existing = this.connections.get(deviceId);

      if (existing !== undefined && existing !== socket) {
        this.options.logger.warn(
          { deviceId, remote: describeSocket(socket) },
          'device opened a second connection',
        );
      }

      state.deviceId = deviceId;
      this.connections.set(deviceId, socket);
      return true;
    }

    if (state.deviceId !== deviceId) {
      this.options.logger.warn(
        { boundDeviceId: state.deviceId, frameDeviceId: deviceId },
        'dropped frame for another device on an established connection',
      );
      return false;
    }

    return true;
  }

  private async handleReading(
    socket: Socket,
    state: ConnectionState,
    frame: Extract<DecodedFrame, { kind: 'reading' }>,
  ): Promise<void> {
    const nowSeconds = Math.floor(this.now() / 1000);

    if (nowSeconds - frame.timestamp > CLOCK_SKEW_WARNING_SECONDS) {
      this.options.logger.warn(
        { deviceId: frame.deviceId, timestamp: frame.timestamp },
        'reading timestamp is more than one hour behind the server',
      );
    }

    try {
      await ingestReading(this.options.pool, {
        deviceId: frame.deviceId,
        sequence: frame.sequence,
        timestamp: frame.timestamp,
        temperatureTenths: frame.temperatureTenths,
        gpioState: frame.gpioState,
        sampleRate: frame.sampleRate,
      });
    } catch (error) {
      this.options.logger.error(
        { err: error, deviceId: frame.deviceId },
        'failed to persist reading',
      );
      return;
    }

    socket.setTimeout(socketIdleTimeoutMs(frame.sampleRate));
  }

  private async handlePoll(
    socket: Socket,
    state: ConnectionState,
    deviceId: number,
    nowMs: number,
  ): Promise<void> {
    if (state.lastPollAtMs !== null && nowMs - state.lastPollAtMs < MIN_POLL_INTERVAL_MS) {
      this.writeCommand(socket, emptyCommandFrame(deviceId));
      return;
    }

    state.lastPollAtMs = nowMs;

    try {
      const command = await dequeueCommand(this.options.pool, deviceId);
      this.writeCommand(socket, command);
    } catch (error) {
      this.options.logger.error({ err: error, deviceId }, 'failed to dequeue a command for a poll');
    }
  }

  private async handleAcknowledgement(
    socket: Socket,
    deviceId: number,
    commandId: number,
    status: AckStatus,
  ): Promise<void> {
    try {
      const applied = await acknowledgeCommand(this.options.pool, deviceId, commandId, status);

      if (!applied) {
        this.options.logger.warn(
          { deviceId, commandId, status },
          'ignored acknowledgement for an unknown or completed command',
        );
      }
    } catch (error) {
      this.options.logger.error(
        { err: error, deviceId, commandId },
        'failed to record a command acknowledgement',
      );
    }
  }

  private writeCommand(socket: Socket, frame: CommandFrame): void {
    if (socket.destroyed) {
      return;
    }

    socket.write(encodeCommand(frame));
  }

  private async handleClose(socket: Socket, state: ConnectionState): Promise<void> {
    const deviceId = state.deviceId;

    if (deviceId === null || this.connections.get(deviceId) !== socket) {
      this.options.logger.info({ remote: describeSocket(socket) }, 'device connection closed');
      return;
    }

    this.connections.delete(deviceId);

    try {
      await this.options.presence.markOffline([deviceId]);
    } catch (error) {
      this.options.logger.error(
        { err: error, deviceId },
        'failed to mark a disconnected device offline',
      );
    }

    this.options.logger.info({ deviceId }, 'device disconnected');
  }
}
