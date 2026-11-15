import { describe, expect, it } from 'vitest';

import {
  type AcknowledgementFrame,
  type CommandFrame,
  FrameError,
  FrameReader,
  MAX_SCAN_BUFFER,
  MAX_TIMESTAMP_SKEW_SECONDS,
  type ReadingFrame,
  crc8,
  decodeFrame,
  encodeAcknowledgement,
  encodeCommand,
  encodePoll,
  encodeReading,
  temperatureCelsius,
  validateFrame,
} from './frame.js';

const hex = (value: string): Buffer => Buffer.from(value.replaceAll(' ', ''), 'hex');

const readingVector = hex('EE 50 12 34 00 07 6A F9 9E C0 00 EA 05 05 53');
const pollVector = hex('EE 52 12 34 A3');
const commandNoneVector = hex('EE 53 12 34 00 00 00 00 00 00 00 25');
const commandRateVector = hex('EE 53 12 34 00 00 00 2A 02 0A 00 23');
const commandToggleVector = hex('EE 53 12 34 00 00 00 2B 01 03 01 32');
const ackExecutedVector = hex('EE 51 12 34 00 00 00 2A 00 4C');
const ackRejectedVector = hex('EE 51 12 34 00 00 00 2B 01 5E');

const reading: ReadingFrame = {
  kind: 'reading',
  deviceId: 0x1234,
  sequence: 7,
  timestamp: 1_794_744_000,
  temperatureTenths: 234,
  gpioState: 0b0000_0101,
  sampleRate: 5,
};

const commandNone: CommandFrame = {
  kind: 'command',
  deviceId: 0x1234,
  commandId: 0,
  type: 0,
  param1: 0,
  param2: 0,
};

const commandRate: CommandFrame = {
  kind: 'command',
  deviceId: 0x1234,
  commandId: 42,
  type: 2,
  param1: 10,
  param2: 0,
};

const commandToggle: CommandFrame = {
  kind: 'command',
  deviceId: 0x1234,
  commandId: 43,
  type: 1,
  param1: 3,
  param2: 1,
};

const ackExecuted: AcknowledgementFrame = {
  kind: 'ack',
  deviceId: 0x1234,
  commandId: 42,
  status: 0,
};

const ackRejected: AcknowledgementFrame = {
  kind: 'ack',
  deviceId: 0x1234,
  commandId: 43,
  status: 1,
};

const now = 1_794_744_000;

describe('crc8', () => {
  it('matches the standard check value', () => {
    expect(crc8(Buffer.from('123456789', 'ascii'))).toBe(0xf4);
  });

  it('is zero for an empty input', () => {
    expect(crc8(new Uint8Array())).toBe(0);
  });
});

describe('frame decoding', () => {
  it('decodes the reading vector', () => {
    expect(decodeFrame(readingVector)).toEqual(reading);
  });

  it('decodes the poll vector', () => {
    expect(decodeFrame(pollVector)).toEqual({ kind: 'poll', deviceId: 0x1234 });
  });

  it('decodes the empty command vector', () => {
    expect(decodeFrame(commandNoneVector)).toEqual(commandNone);
  });

  it('decodes the set-sample-rate command vector', () => {
    expect(decodeFrame(commandRateVector)).toEqual(commandRate);
  });

  it('decodes the toggle command vector', () => {
    expect(decodeFrame(commandToggleVector)).toEqual(commandToggle);
  });

  it('decodes the executed acknowledgement vector', () => {
    expect(decodeFrame(ackExecutedVector)).toEqual(ackExecuted);
  });

  it('decodes the rejected acknowledgement vector', () => {
    expect(decodeFrame(ackRejectedVector)).toEqual(ackRejected);
  });

  it('converts tenths of a degree to Celsius', () => {
    expect(temperatureCelsius(234)).toBe(23.4);
    expect(temperatureCelsius(-50)).toBe(-5);
  });

  it('rejects a truncated frame', () => {
    expect(() => decodeFrame(readingVector.subarray(0, 14))).toThrow(
      expect.objectContaining({ code: 'length' }),
    );
  });

  it('rejects a frame with trailing bytes', () => {
    expect(() => decodeFrame(Buffer.concat([pollVector, Buffer.from([0])]))).toThrow(
      expect.objectContaining({ code: 'length' }),
    );
  });

  it('rejects an unknown magic value', () => {
    const frame = Buffer.from(readingVector);
    frame.writeUInt16BE(0xee54, 0);
    expect(() => decodeFrame(frame)).toThrow(expect.objectContaining({ code: 'magic' }));
  });

  it('rejects a frame with a bad checksum', () => {
    const frame = Buffer.from(readingVector);
    frame[8] = (frame[8] ?? 0) ^ 0xff;
    expect(() => decodeFrame(frame)).toThrow(expect.objectContaining({ code: 'crc' }));
  });

  it('reports a frame error with a message', () => {
    const error = (() => {
      try {
        decodeFrame(Buffer.alloc(0));
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(FrameError);
    expect((error as FrameError).message.length).toBeGreaterThan(0);
  });
});

describe('frame encoding', () => {
  it('encodes the reading vector', () => {
    expect(encodeReading(reading)).toEqual(readingVector);
  });

  it('encodes the poll vector', () => {
    expect(encodePoll({ kind: 'poll', deviceId: 0x1234 })).toEqual(pollVector);
  });

  it('encodes the empty command vector', () => {
    expect(encodeCommand(commandNone)).toEqual(commandNoneVector);
  });

  it('encodes the set-sample-rate command vector', () => {
    expect(encodeCommand(commandRate)).toEqual(commandRateVector);
  });

  it('encodes the toggle command vector', () => {
    expect(encodeCommand(commandToggle)).toEqual(commandToggleVector);
  });

  it('encodes the executed acknowledgement vector', () => {
    expect(encodeAcknowledgement(ackExecuted)).toEqual(ackExecutedVector);
  });

  it('encodes the rejected acknowledgement vector', () => {
    expect(encodeAcknowledgement(ackRejected)).toEqual(ackRejectedVector);
  });

  it('encodes a negative temperature', () => {
    const frame = encodeReading({ ...reading, temperatureTenths: -50 });
    expect(decodeFrame(frame)).toEqual({ ...reading, temperatureTenths: -50 });
  });

  it('round-trips the largest allowed temperature', () => {
    const frame = encodeReading({ ...reading, temperatureTenths: 1500 });
    expect(decodeFrame(frame)).toEqual({ ...reading, temperatureTenths: 1500 });
  });

  it('refuses to encode a temperature above the allowed band', () => {
    expect(() => encodeReading({ ...reading, temperatureTenths: 1501 })).toThrow(
      expect.objectContaining({ code: 'temperature' }),
    );
  });

  it('refuses to encode a temperature below the allowed band', () => {
    expect(() => encodeReading({ ...reading, temperatureTenths: -1001 })).toThrow(
      expect.objectContaining({ code: 'temperature' }),
    );
  });

  it('refuses to encode device ID 0', () => {
    expect(() => encodePoll({ kind: 'poll', deviceId: 0 })).toThrow(
      expect.objectContaining({ code: 'device-id' }),
    );
  });

  it('refuses to encode a sample rate of 0', () => {
    expect(() => encodeReading({ ...reading, sampleRate: 0 })).toThrow(
      expect.objectContaining({ code: 'sample-rate' }),
    );
  });

  it('refuses to encode a timestamp of 0', () => {
    expect(() => encodeReading({ ...reading, timestamp: 0 })).toThrow(
      expect.objectContaining({ code: 'timestamp' }),
    );
  });

  it('refuses a command ID on the empty command', () => {
    expect(() => encodeCommand({ ...commandNone, commandId: 1 })).toThrow(
      expect.objectContaining({ code: 'command-id' }),
    );
  });

  it('refuses a non-empty command with command ID 0', () => {
    expect(() => encodeCommand({ ...commandToggle, commandId: 0 })).toThrow(
      expect.objectContaining({ code: 'command-id' }),
    );
  });

  it('refuses an unknown command type', () => {
    expect(() => encodeCommand({ ...commandToggle, type: 3 as 0 })).toThrow(
      expect.objectContaining({ code: 'command-type' }),
    );
  });

  it('refuses a GPIO pin outside 0 to 7', () => {
    expect(() => encodeCommand({ ...commandToggle, param1: 8 })).toThrow(
      expect.objectContaining({ code: 'command-parameter' }),
    );
  });

  it('refuses a GPIO state other than 0 or 1', () => {
    expect(() => encodeCommand({ ...commandToggle, param2: 2 })).toThrow(
      expect.objectContaining({ code: 'command-parameter' }),
    );
  });

  it('refuses a sample rate of 0 in a command', () => {
    expect(() => encodeCommand({ ...commandRate, param1: 0 })).toThrow(
      expect.objectContaining({ code: 'command-parameter' }),
    );
  });

  it('refuses a second parameter on set-sample-rate', () => {
    expect(() => encodeCommand({ ...commandRate, param2: 1 })).toThrow(
      expect.objectContaining({ code: 'command-parameter' }),
    );
  });

  it('refuses an unknown acknowledgement status', () => {
    expect(() => encodeAcknowledgement({ ...ackExecuted, status: 3 as 0 })).toThrow(
      expect.objectContaining({ code: 'ack-status' }),
    );
  });
});

describe('frame validation', () => {
  it('accepts the reading vector', () => {
    expect(() => validateFrame(reading, now)).not.toThrow();
  });

  it('rejects device ID 0 in a reading', () => {
    expect(() => validateFrame({ ...reading, deviceId: 0 }, now)).toThrow(
      expect.objectContaining({ code: 'device-id' }),
    );
  });

  it('rejects sample rate 0 in a reading', () => {
    expect(() => validateFrame({ ...reading, sampleRate: 0 }, now)).toThrow(
      expect.objectContaining({ code: 'sample-rate' }),
    );
  });

  it('rejects a zero timestamp', () => {
    expect(() => validateFrame({ ...reading, timestamp: 0 }, now)).toThrow(
      expect.objectContaining({ code: 'timestamp' }),
    );
  });

  it('rejects a temperature outside the band', () => {
    expect(() => validateFrame({ ...reading, temperatureTenths: 1501 }, now)).toThrow(
      expect.objectContaining({ code: 'temperature' }),
    );
  });

  it('rejects a timestamp beyond the allowed clock skew', () => {
    expect(() =>
      validateFrame({ ...reading, timestamp: now + MAX_TIMESTAMP_SKEW_SECONDS + 1 }, now),
    ).toThrow(expect.objectContaining({ code: 'timestamp' }));
  });

  it('accepts a timestamp at the clock skew boundary', () => {
    expect(() =>
      validateFrame({ ...reading, timestamp: now + MAX_TIMESTAMP_SKEW_SECONDS }, now),
    ).not.toThrow();
  });

  it('accepts an old timestamp', () => {
    expect(() => validateFrame({ ...reading, timestamp: 1 }, now)).not.toThrow();
  });

  it('rejects device ID 0 in a poll', () => {
    expect(() => validateFrame({ kind: 'poll', deviceId: 0 }, now)).toThrow(
      expect.objectContaining({ code: 'device-id' }),
    );
  });

  it('rejects device ID 0 in an acknowledgement', () => {
    expect(() => validateFrame({ ...ackExecuted, deviceId: 0 }, now)).toThrow(
      expect.objectContaining({ code: 'device-id' }),
    );
  });

  it('rejects a command addressed to device 0', () => {
    expect(() => validateFrame({ ...commandNone, deviceId: 0 }, now)).toThrow(
      expect.objectContaining({ code: 'device-id' }),
    );
  });
});

describe('stream reader', () => {
  it('decodes two frames from one chunk', () => {
    const reader = new FrameReader();
    const results = reader.push(Buffer.concat([readingVector, pollVector]));

    expect(results).toEqual([{ frame: reading }, { frame: { kind: 'poll', deviceId: 0x1234 } }]);
    expect(reader.bufferedBytes).toBe(0);
  });

  it('decodes a frame split across chunks', () => {
    const reader = new FrameReader();

    expect(reader.push(readingVector.subarray(0, 6))).toEqual([]);
    expect(reader.push(readingVector.subarray(6))).toEqual([{ frame: reading }]);
  });

  it('discards junk before a valid frame', () => {
    const reader = new FrameReader();
    const results = reader.push(Buffer.concat([Buffer.from([0x00, 0x11, 0x22]), pollVector]));

    expect(results).toEqual([{ frame: { kind: 'poll', deviceId: 0x1234 } }]);
  });

  it('reports a bad checksum and resynchronises', () => {
    const reader = new FrameReader();
    const corrupt = Buffer.from(readingVector);
    corrupt[11] = 0;
    const results = reader.push(Buffer.concat([corrupt, pollVector]));

    expect(results).toHaveLength(2);
    const [first, second] = results;
    if (first === undefined || !('error' in first)) {
      throw new Error('Expected a frame error first');
    }
    expect(first.error).toBeInstanceOf(FrameError);
    expect(first.error.code).toBe('crc');
    expect(second).toEqual({ frame: { kind: 'poll', deviceId: 0x1234 } });
  });

  it('keeps a partial frame until the rest arrives', () => {
    const reader = new FrameReader();
    reader.push(readingVector.subarray(0, 14));

    expect(reader.bufferedBytes).toBe(14);
    expect(reader.push(readingVector.subarray(14))).toEqual([{ frame: reading }]);
    expect(reader.bufferedBytes).toBe(0);
  });

  it('does not grow without bound on a stream of stray magic bytes', () => {
    const reader = new FrameReader();
    const junk = Buffer.alloc(MAX_SCAN_BUFFER * 2, 0xee);

    const results = reader.push(junk);

    expect(results).toEqual([]);
    expect(reader.bufferedBytes).toBeLessThanOrEqual(MAX_SCAN_BUFFER);
  });
});
