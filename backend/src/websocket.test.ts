import { describe, expect, it } from 'vitest';

import { MAX_SUBSCRIPTION_DEVICES, parseClientEvent } from './websocket.js';

describe('websocket client messages', () => {
  it('accepts a subscription and removes duplicates', () => {
    expect(
      parseClientEvent({ event: 'subscribe', data: { deviceIds: [4660, 1, 4660, 65535] } }),
    ).toEqual({
      event: { event: 'subscribe', data: { deviceIds: [4660, 1, 65535] } },
    });
  });

  it('accepts an empty subscription', () => {
    expect(parseClientEvent({ event: 'subscribe', data: { deviceIds: [] } })).toEqual({
      event: { event: 'subscribe', data: { deviceIds: [] } },
    });
  });

  it.each([
    null,
    [],
    'subscribe',
    {},
    { event: 'subscribe' },
    { event: 'subscribe', data: {}, extra: true },
    { event: 'subscribe', data: { deviceIds: [], extra: true } },
    { event: 'unsubscribe', data: { deviceIds: [] } },
    { event: 'subscribe', data: { deviceIds: 'all' } },
    { event: 'subscribe', data: { deviceIds: [0] } },
    { event: 'subscribe', data: { deviceIds: [65536] } },
    { event: 'subscribe', data: { deviceIds: [1.5] } },
    { event: 'subscribe', data: { deviceIds: ['1'] } },
    { event: 'subscribe', data: { deviceIds: [null] } },
  ])('rejects a malformed message: %j', (value) => {
    const result = parseClientEvent(value);

    expect('code' in result).toBe(true);
  });

  it('rejects a subscription above the device limit', () => {
    const result = parseClientEvent({
      event: 'subscribe',
      data: { deviceIds: Array.from({ length: MAX_SUBSCRIPTION_DEVICES + 1 }, (_, i) => i + 1) },
    });

    expect(result).toMatchObject({ code: 'validation_error' });
  });

  it('reports an unsupported event distinctly', () => {
    expect(parseClientEvent({ event: 'device:status', data: { deviceIds: [] } })).toMatchObject({
      code: 'unsupported_event',
    });
  });
});
