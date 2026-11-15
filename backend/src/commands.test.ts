import { describe, expect, it } from 'vitest';

import {
  buildCommandFrame,
  commandStatusForAcknowledgement,
  emptyCommandFrame,
  parseCommandPayload,
} from './commands.js';

describe('command payload parsing', () => {
  it('accepts a toggle payload', () => {
    expect(parseCommandPayload('toggle_gpio', { pin: 3, state: 1 })).toEqual({
      pin: 3,
      state: 1,
    });
  });

  it('accepts pin 0 in state 0', () => {
    expect(parseCommandPayload('toggle_gpio', { pin: 0, state: 0 })).toEqual({
      pin: 0,
      state: 0,
    });
  });

  it('rejects a toggle pin above 7', () => {
    expect(() => parseCommandPayload('toggle_gpio', { pin: 8, state: 1 })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects a toggle state other than 0 or 1', () => {
    expect(() => parseCommandPayload('toggle_gpio', { pin: 1, state: 2 })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects a fractional toggle pin', () => {
    expect(() => parseCommandPayload('toggle_gpio', { pin: 1.5, state: 1 })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects a toggle payload with missing fields', () => {
    expect(() => parseCommandPayload('toggle_gpio', { pin: 1 })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects a toggle payload with extra fields', () => {
    expect(() => parseCommandPayload('toggle_gpio', { pin: 1, state: 1, extra: true })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects a non-object payload', () => {
    expect(() => parseCommandPayload('set_sample_rate', [5])).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects a null payload', () => {
    expect(() => parseCommandPayload('set_sample_rate', null)).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('accepts a sample rate payload', () => {
    expect(parseCommandPayload('set_sample_rate', { seconds: 10 })).toEqual({ seconds: 10 });
  });

  it('accepts the sample rate boundaries', () => {
    expect(parseCommandPayload('set_sample_rate', { seconds: 1 })).toEqual({ seconds: 1 });
    expect(parseCommandPayload('set_sample_rate', { seconds: 255 })).toEqual({ seconds: 255 });
  });

  it('rejects sample rate 0', () => {
    expect(() => parseCommandPayload('set_sample_rate', { seconds: 0 })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects a sample rate above 255', () => {
    expect(() => parseCommandPayload('set_sample_rate', { seconds: 256 })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects a sample rate with extra fields', () => {
    expect(() => parseCommandPayload('set_sample_rate', { seconds: 5, pin: 1 })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects an unknown command type', () => {
    expect(() => parseCommandPayload('reboot' as 'toggle_gpio', {})).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });
});

describe('command frame construction', () => {
  it('builds an empty command frame', () => {
    expect(emptyCommandFrame(0x1234)).toEqual({
      kind: 'command',
      deviceId: 0x1234,
      commandId: 0,
      type: 0,
      param1: 0,
      param2: 0,
    });
  });

  it('builds a toggle command frame', () => {
    expect(
      buildCommandFrame(0x1234, {
        id: 43,
        type: 'toggle_gpio',
        payload: { pin: 3, state: 1 },
      }),
    ).toEqual({
      kind: 'command',
      deviceId: 0x1234,
      commandId: 43,
      type: 1,
      param1: 3,
      param2: 1,
    });
  });

  it('builds a sample rate command frame', () => {
    expect(
      buildCommandFrame(0x1234, {
        id: 42,
        type: 'set_sample_rate',
        payload: { seconds: 10 },
      }),
    ).toEqual({
      kind: 'command',
      deviceId: 0x1234,
      commandId: 42,
      type: 2,
      param1: 10,
      param2: 0,
    });
  });

  it('refuses an invalid stored payload', () => {
    expect(() =>
      buildCommandFrame(0x1234, {
        id: 42,
        type: 'toggle_gpio',
        payload: { pin: 9, state: 1 },
      }),
    ).toThrow(expect.objectContaining({ code: 'validation_error' }));
  });
});

describe('acknowledgement mapping', () => {
  it('maps executed to executed', () => {
    expect(commandStatusForAcknowledgement(0)).toBe('executed');
  });

  it('maps rejected to failed', () => {
    expect(commandStatusForAcknowledgement(1)).toBe('failed');
  });

  it('maps unsupported to failed', () => {
    expect(commandStatusForAcknowledgement(2)).toBe('failed');
  });
});
