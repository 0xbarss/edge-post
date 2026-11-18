import { describe, expect, it } from 'vitest';

import { formatGpio, formatRelativeTime, formatTemperatureDelta } from './format';
import {
  countPointsInWindow,
  mergePoints,
  nextReconnectDelay,
  ratePerMinute,
  temperatureDelta,
  valueAtOrBefore,
} from './telemetry';
import type { ReadingPoint } from './types';

const points: ReadingPoint[] = [
  { ts: 1_000, temperature: 20 },
  { ts: 2_000, temperature: 21 },
  { ts: 3_000, temperature: 22 },
];

describe('reading series', () => {
  it('merges, sorts, and deduplicates by timestamp', () => {
    expect(
      mergePoints(
        [
          { ts: 2_000, temperature: 21 },
          { ts: 1_000, temperature: 20 },
        ],
        [
          { ts: 2_000, temperature: 21.5 },
          { ts: 3_000, temperature: 22 },
        ],
      ),
    ).toEqual([
      { ts: 1_000, temperature: 20 },
      { ts: 2_000, temperature: 21.5 },
      { ts: 3_000, temperature: 22 },
    ]);
  });

  it('keeps only the newest points when the limit is reached', () => {
    const merged = mergePoints([], points, 2);

    expect(merged.map((point) => point.ts)).toEqual([2_000, 3_000]);
  });

  it('finds the last value at or before a timestamp', () => {
    expect(valueAtOrBefore(points, 2_500)?.temperature).toBe(21);
    expect(valueAtOrBefore(points, 500)).toBeNull();
  });

  it('counts a half-open time window', () => {
    expect(countPointsInWindow(points, 1_000, 3_000)).toBe(2);
    expect(countPointsInWindow(points, 1_001, 3_001)).toBe(2);
  });

  it('compares the current and previous minute', () => {
    const now = 200_000;
    const rate = ratePerMinute(
      [
        { ts: now - 150_000, temperature: 20 },
        { ts: now - 90_000, temperature: 20 },
        { ts: now - 30_000, temperature: 21 },
        { ts: now - 10_000, temperature: 21 },
      ],
      now,
    );

    expect(rate).toEqual({ current: 2, previous: 1 });
  });

  it('computes a temperature delta against the five minute baseline', () => {
    const latest = 400_000;
    const series = [
      { ts: latest - 300_000, temperature: 20 },
      { ts: latest, temperature: 23.4 },
    ];

    expect(temperatureDelta(series)).toBeCloseTo(3.4);
    expect(temperatureDelta([{ ts: latest, temperature: 23.4 }])).toBeNull();
  });

  it('doubles the reconnect delay up to the maximum', () => {
    expect(nextReconnectDelay(1_000)).toBe(2_000);
    expect(nextReconnectDelay(20_000)).toBe(30_000);
    expect(nextReconnectDelay(30_000)).toBe(30_000);
  });
});

describe('formatting', () => {
  it('formats relative times at each boundary', () => {
    expect(formatRelativeTime(null, 0)).toBe('—');
    expect(formatRelativeTime(1_000, 2_000)).toBe('just now');
    expect(formatRelativeTime(1_000, 13_000)).toBe('12s ago');
    expect(formatRelativeTime(1_000, 61_000)).toBe('1m ago');
    expect(formatRelativeTime(1_000, 3_601_000)).toBe('1h ago');
    expect(formatRelativeTime(1_000, 86_401_000)).toBe('1d ago');
  });

  it('formats a directional temperature delta', () => {
    expect(formatTemperatureDelta(null)).toBe('No baseline yet');
    expect(formatTemperatureDelta(0)).toBe('Flat vs 5 min ago');
    expect(formatTemperatureDelta(1.24)).toBe('+1.2° vs 5 min ago');
    expect(formatTemperatureDelta(-0.8)).toBe('−0.8° vs 5 min ago');
  });

  it('renders the GPIO bitmask as eight bits', () => {
    expect(formatGpio(5)).toBe('00000101');
    expect(formatGpio(255)).toBe('11111111');
  });
});
