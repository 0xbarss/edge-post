import { describe, expect, it } from 'vitest';

import { parseServerEvent } from './api';

describe('websocket messages', () => {
  it('parses a reading event', () => {
    expect(
      parseServerEvent(
        JSON.stringify({
          event: 'reading',
          data: { deviceId: 4660, ts: '2026-11-18T12:00:00.000Z', temperature: 23.4, gpioState: 5 },
        }),
      ),
    ).toEqual({
      event: 'reading',
      data: { deviceId: 4660, ts: '2026-11-18T12:00:00.000Z', temperature: 23.4, gpioState: 5 },
    });
  });

  it('parses a status event', () => {
    expect(
      parseServerEvent(
        JSON.stringify({ event: 'device:status', data: { deviceId: 7, status: 'offline' } }),
      ),
    ).toEqual({ event: 'device:status', data: { deviceId: 7, status: 'offline' } });
  });

  it('parses an error event', () => {
    expect(
      parseServerEvent(
        JSON.stringify({ event: 'error', data: { code: 'validation_error', message: 'bad ids' } }),
      ),
    ).toEqual({ event: 'error', data: { code: 'validation_error', message: 'bad ids' } });
  });

  it.each([
    '{',
    'null',
    '[]',
    JSON.stringify({ event: 'reading', data: { deviceId: 1 } }),
    JSON.stringify({
      event: 'reading',
      data: { deviceId: 1.5, ts: 'x', temperature: 1, gpioState: 0 },
    }),
    JSON.stringify({ event: 'device:status', data: { deviceId: 1, status: 'sleeping' } }),
    JSON.stringify({ event: 'error', data: { code: 1, message: 'x' } }),
    JSON.stringify({ event: 'unknown', data: {} }),
  ])('rejects a malformed event: %s', (raw) => {
    expect(parseServerEvent(raw)).toBeNull();
  });
});
