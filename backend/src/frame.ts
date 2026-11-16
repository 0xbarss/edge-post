export const FRAME_MAGIC = {
  reading: 0xee50,
  ack: 0xee51,
  poll: 0xee52,
  command: 0xee53,
} as const;

export const FRAME_SIZE = {
  reading: 15,
  ack: 10,
  poll: 5,
  command: 12,
} as const;

export const MAX_FRAME_SIZE = Math.max(...Object.values(FRAME_SIZE));
export const MAX_SCAN_BUFFER = 4096;
export const MIN_TEMPERATURE_TENTHS = -1000;
export const MAX_TEMPERATURE_TENTHS = 1500;
export const MAX_TIMESTAMP_SKEW_SECONDS = 24 * 60 * 60;

export type FrameKind = keyof typeof FRAME_MAGIC;
export type AckStatus = 0 | 1 | 2;
export type CommandFrameType = 0 | 1 | 2;

export interface ReadingFrame {
  kind: 'reading';
  deviceId: number;
  sequence: number;
  timestamp: number;
  temperatureTenths: number;
  gpioState: number;
  sampleRate: number;
}

export interface PollFrame {
  kind: 'poll';
  deviceId: number;
}

export interface CommandFrame {
  kind: 'command';
  deviceId: number;
  commandId: number;
  type: CommandFrameType;
  param1: number;
  param2: number;
}

export interface AcknowledgementFrame {
  kind: 'ack';
  deviceId: number;
  commandId: number;
  status: AckStatus;
}

export type DecodedFrame = ReadingFrame | PollFrame | CommandFrame | AcknowledgementFrame;

export type FrameErrorCode =
  | 'length'
  | 'magic'
  | 'crc'
  | 'device-id'
  | 'sequence'
  | 'sample-rate'
  | 'timestamp'
  | 'temperature'
  | 'gpio-state'
  | 'command-id'
  | 'command-type'
  | 'command-parameter'
  | 'ack-status';

export class FrameError extends Error {
  readonly code: FrameErrorCode;

  constructor(code: FrameErrorCode, message: string) {
    super(message);
    this.name = 'FrameError';
    this.code = code;
  }
}

export type FrameReadResult = { frame: DecodedFrame } | { error: FrameError };

export function crc8(bytes: Uint8Array): number {
  let crc = 0;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }

  return crc;
}

export function temperatureCelsius(tenths: number): number {
  return tenths / 10;
}

function kindForMagic(magic: number): FrameKind | undefined {
  switch (magic) {
    case FRAME_MAGIC.reading:
      return 'reading';
    case FRAME_MAGIC.ack:
      return 'ack';
    case FRAME_MAGIC.poll:
      return 'poll';
    case FRAME_MAGIC.command:
      return 'command';
    default:
      return undefined;
  }
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

export function decodeFrame(bytes: Uint8Array): DecodedFrame {
  if (bytes.length < 2) {
    throw new FrameError('length', `Frame is too short: ${bytes.length} bytes`);
  }

  const buffer = toBuffer(bytes);
  const magic = buffer.readUInt16BE(0);
  const kind = kindForMagic(magic);

  if (kind === undefined) {
    throw new FrameError('magic', `Unknown frame magic 0x${magic.toString(16)}`);
  }

  const expectedSize = FRAME_SIZE[kind];
  if (buffer.length !== expectedSize) {
    throw new FrameError(
      'length',
      `${kind} frame must be ${expectedSize} bytes, got ${buffer.length}`,
    );
  }

  const receivedCrc = buffer.readUInt8(expectedSize - 1);
  const computedCrc = crc8(buffer.subarray(0, expectedSize - 1));
  if (receivedCrc !== computedCrc) {
    throw new FrameError(
      'crc',
      `${kind} frame checksum mismatch: expected 0x${computedCrc.toString(16)}, got 0x${receivedCrc.toString(16)}`,
    );
  }

  switch (kind) {
    case 'reading':
      return {
        kind,
        deviceId: buffer.readUInt16BE(2),
        sequence: buffer.readUInt16BE(4),
        timestamp: buffer.readUInt32BE(6),
        temperatureTenths: buffer.readInt16BE(10),
        gpioState: buffer.readUInt8(12),
        sampleRate: buffer.readUInt8(13),
      };
    case 'ack':
      return {
        kind,
        deviceId: buffer.readUInt16BE(2),
        commandId: buffer.readUInt32BE(4),
        status: buffer.readUInt8(8) as AckStatus,
      };
    case 'poll':
      return { kind, deviceId: buffer.readUInt16BE(2) };
    case 'command':
      return {
        kind,
        deviceId: buffer.readUInt16BE(2),
        commandId: buffer.readUInt32BE(4),
        type: buffer.readUInt8(8) as CommandFrameType,
        param1: buffer.readUInt8(9),
        param2: buffer.readUInt8(10),
      };
  }
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  code: FrameErrorCode,
  field: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new FrameError(code, `${field} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertDeviceId(deviceId: number): void {
  assertIntegerInRange(deviceId, 1, 65535, 'device-id', 'Device ID');
}

function assertTemperature(temperatureTenths: number): void {
  assertIntegerInRange(
    temperatureTenths,
    MIN_TEMPERATURE_TENTHS,
    MAX_TEMPERATURE_TENTHS,
    'temperature',
    'Temperature',
  );
}

function assertReadingFields(frame: ReadingFrame): void {
  assertDeviceId(frame.deviceId);
  assertIntegerInRange(frame.sequence, 0, 65535, 'sequence', 'Sequence');
  assertIntegerInRange(frame.timestamp, 1, 0xffffffff, 'timestamp', 'Timestamp');
  assertTemperature(frame.temperatureTenths);
  assertIntegerInRange(frame.gpioState, 0, 255, 'gpio-state', 'GPIO state');
  assertIntegerInRange(frame.sampleRate, 1, 255, 'sample-rate', 'Sample rate');
}

function assertCommandFields(frame: CommandFrame): void {
  assertDeviceId(frame.deviceId);
  assertIntegerInRange(frame.commandId, 0, 0xffffffff, 'command-id', 'Command ID');

  if (frame.type !== 0 && frame.type !== 1 && frame.type !== 2) {
    throw new FrameError('command-type', `Unknown command type ${String(frame.type)}`);
  }

  if (frame.type === 0) {
    if (frame.commandId !== 0) {
      throw new FrameError('command-id', 'An empty command must carry command ID 0');
    }
    if (frame.param1 !== 0 || frame.param2 !== 0) {
      throw new FrameError('command-parameter', 'An empty command must carry zero parameters');
    }
    return;
  }

  if (frame.commandId === 0) {
    throw new FrameError('command-id', 'A command must carry a nonzero command ID');
  }

  if (frame.type === 1) {
    assertIntegerInRange(frame.param1, 0, 7, 'command-parameter', 'GPIO pin');
    assertIntegerInRange(frame.param2, 0, 1, 'command-parameter', 'GPIO state');
    return;
  }

  assertIntegerInRange(frame.param1, 1, 255, 'command-parameter', 'Sample rate');
  if (frame.param2 !== 0) {
    throw new FrameError('command-parameter', 'Set-sample-rate must carry a zero second parameter');
  }
}

function assertAcknowledgementFields(frame: AcknowledgementFrame): void {
  assertDeviceId(frame.deviceId);
  assertIntegerInRange(frame.commandId, 0, 0xffffffff, 'command-id', 'Command ID');
  assertIntegerInRange(frame.status, 0, 2, 'ack-status', 'Acknowledgement status');
}

export function encodeReading(frame: ReadingFrame): Buffer {
  assertReadingFields(frame);

  const buffer = Buffer.alloc(FRAME_SIZE.reading);
  buffer.writeUInt16BE(FRAME_MAGIC.reading, 0);
  buffer.writeUInt16BE(frame.deviceId, 2);
  buffer.writeUInt16BE(frame.sequence, 4);
  buffer.writeUInt32BE(frame.timestamp, 6);
  buffer.writeInt16BE(frame.temperatureTenths, 10);
  buffer.writeUInt8(frame.gpioState, 12);
  buffer.writeUInt8(frame.sampleRate, 13);
  buffer.writeUInt8(crc8(buffer.subarray(0, 14)), 14);
  return buffer;
}

export function encodePoll(frame: PollFrame): Buffer {
  assertDeviceId(frame.deviceId);

  const buffer = Buffer.alloc(FRAME_SIZE.poll);
  buffer.writeUInt16BE(FRAME_MAGIC.poll, 0);
  buffer.writeUInt16BE(frame.deviceId, 2);
  buffer.writeUInt8(crc8(buffer.subarray(0, 4)), 4);
  return buffer;
}

export function encodeCommand(frame: CommandFrame): Buffer {
  assertCommandFields(frame);

  const buffer = Buffer.alloc(FRAME_SIZE.command);
  buffer.writeUInt16BE(FRAME_MAGIC.command, 0);
  buffer.writeUInt16BE(frame.deviceId, 2);
  buffer.writeUInt32BE(frame.commandId, 4);
  buffer.writeUInt8(frame.type, 8);
  buffer.writeUInt8(frame.param1, 9);
  buffer.writeUInt8(frame.param2, 10);
  buffer.writeUInt8(crc8(buffer.subarray(0, 11)), 11);
  return buffer;
}

export function encodeAcknowledgement(frame: AcknowledgementFrame): Buffer {
  assertAcknowledgementFields(frame);

  const buffer = Buffer.alloc(FRAME_SIZE.ack);
  buffer.writeUInt16BE(FRAME_MAGIC.ack, 0);
  buffer.writeUInt16BE(frame.deviceId, 2);
  buffer.writeUInt32BE(frame.commandId, 4);
  buffer.writeUInt8(frame.status, 8);
  buffer.writeUInt8(crc8(buffer.subarray(0, 9)), 9);
  return buffer;
}

export function validateFrame(frame: DecodedFrame, nowSeconds: number): void {
  switch (frame.kind) {
    case 'reading':
      assertReadingFields(frame);
      if (frame.timestamp > nowSeconds + MAX_TIMESTAMP_SKEW_SECONDS) {
        throw new FrameError('timestamp', 'Timestamp is more than 24 hours ahead of the server');
      }
      return;
    case 'poll':
    case 'ack':
      assertDeviceId(frame.deviceId);
      if (frame.kind === 'ack') {
        assertAcknowledgementFields(frame);
      }
      return;
    case 'command':
      assertCommandFields(frame);
  }
}

export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);

  get bufferedBytes(): number {
    return this.buffer.length;
  }

  push(chunk: Uint8Array): FrameReadResult[] {
    const incoming = toBuffer(chunk);
    this.buffer = this.buffer.length === 0 ? incoming : Buffer.concat([this.buffer, incoming]);

    const results: FrameReadResult[] = [];

    for (;;) {
      const magicIndex = this.buffer.indexOf(FRAME_MAGIC.reading >> 8);
      if (magicIndex === -1) {
        this.buffer = Buffer.alloc(0);
        break;
      }

      if (magicIndex > 0) {
        this.buffer = this.buffer.subarray(magicIndex);
      }

      if (this.buffer.length < 2) {
        break;
      }

      const magic = this.buffer.readUInt16BE(0);
      const kind = kindForMagic(magic);

      if (kind === undefined) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const size = FRAME_SIZE[kind];
      if (this.buffer.length < size) {
        break;
      }

      const candidate = this.buffer.subarray(0, size);

      try {
        results.push({ frame: decodeFrame(candidate) });
        this.buffer = this.buffer.subarray(size);
      } catch (error) {
        if (!(error instanceof FrameError)) {
          throw error;
        }
        results.push({ error });
        this.buffer = this.buffer.subarray(1);
      }
    }

    if (this.buffer.length > MAX_SCAN_BUFFER) {
      this.buffer = this.buffer.subarray(this.buffer.length - MAX_SCAN_BUFFER);
    }

    return results;
  }
}
