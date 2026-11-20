import net from 'node:net';

import {
  FRAME_SIZE,
  decodeFrame,
  encodeAcknowledgement,
  encodePoll,
  encodeReading,
} from './frame.js';
import { createLogger } from './logger.js';

const logger = createLogger('info');
const TCP_PORT = Number(process.env.TCP_PORT ?? 5000);
const TCP_HOST = process.env.TCP_HOST ?? '127.0.0.1';

interface DeviceState {
  deviceId: number;
  sampleRate: number;
  gpioState: number;
  sequence: number;
  baseTemp: number;
}

const NODES: DeviceState[] = [
  { deviceId: 101, sampleRate: 5, gpioState: 0b00000101, sequence: 1, baseTemp: 24.2 },
  { deviceId: 102, sampleRate: 10, gpioState: 0b00000001, sequence: 1, baseTemp: 21.8 },
];

function simulateNode(state: DeviceState): void {
  let timer: NodeJS.Timeout | null = null;
  let socket: net.Socket | null = null;
  let buffer = Buffer.alloc(0);

  const connect = (): void => {
    socket = net.createConnection({ host: TCP_HOST, port: TCP_PORT }, () => {
      logger.info(
        { deviceId: state.deviceId, host: TCP_HOST, port: TCP_PORT },
        'Simulator connected',
      );
      sendCycle();
    });

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= FRAME_SIZE.command) {
        const frameBuf = buffer.subarray(0, FRAME_SIZE.command);
        buffer = buffer.subarray(FRAME_SIZE.command);

        try {
          const frame = decodeFrame(frameBuf);
          if (frame.kind === 'command' && frame.deviceId === state.deviceId) {
            handleCommand(frame.commandId, frame.type, frame.param1, frame.param2);
          }
        } catch (error) {
          logger.error({ deviceId: state.deviceId, error }, 'Error decoding command frame');
        }
      }
    });

    socket.on('error', (err) => {
      logger.warn({ deviceId: state.deviceId, err: err.message }, 'Simulator socket warning');
    });

    socket.on('close', () => {
      logger.info({ deviceId: state.deviceId }, 'Simulator disconnected; retrying in 5s');
      socket = null;
      if (timer !== null) clearTimeout(timer);
      setTimeout(connect, 5000);
    });
  };

  const handleCommand = (commandId: number, type: number, param1: number, param2: number): void => {
    if (type === 0) {
      return;
    }

    if (type === 1) {
      const pin = param1;
      const level = param2;
      if (level === 1) {
        state.gpioState |= 1 << pin;
      } else {
        state.gpioState &= ~(1 << pin);
      }
      logger.info({ deviceId: state.deviceId, pin, level }, 'Applied GPIO toggle');
    } else if (type === 2) {
      state.sampleRate = param1;
      logger.info(
        { deviceId: state.deviceId, sampleRate: state.sampleRate },
        'Applied sample rate change',
      );
    }

    if (socket !== null && !socket.destroyed) {
      const ack = encodeAcknowledgement({
        kind: 'ack',
        deviceId: state.deviceId,
        commandId,
        status: 0,
      });
      socket.write(ack);
    }
  };

  const sendCycle = (): void => {
    if (socket === null || socket.destroyed) return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const noise = (Math.sin(state.sequence * 0.3) + Math.cos(state.sequence * 0.15)) * 0.5;
    const tempTenths = Math.round((state.baseTemp + noise) * 10);

    const reading = encodeReading({
      kind: 'reading',
      deviceId: state.deviceId,
      sequence: state.sequence,
      timestamp: nowSeconds,
      temperatureTenths: tempTenths,
      gpioState: state.gpioState,
      sampleRate: state.sampleRate,
    });

    socket.write(reading);

    const poll = encodePoll({
      kind: 'poll',
      deviceId: state.deviceId,
    });
    socket.write(poll);

    state.sequence = (state.sequence + 1) & 0xffff;
    if (state.sequence === 0) state.sequence = 1;

    timer = setTimeout(sendCycle, Math.max(1, state.sampleRate) * 1000);
  };

  connect();
}

logger.info({ count: NODES.length }, 'Starting Edge Post simulator');
for (const node of NODES) {
  simulateNode(node);
}
