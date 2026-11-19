import type { ReadingPoint } from './types';

export const MAX_POINTS = 2_000;
export const HISTORY_WINDOW_MS = 15 * 60 * 1000;
export const RECONNECT_INITIAL_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export function mergePoints(
  existing: ReadingPoint[],
  incoming: ReadingPoint[],
  limit: number = MAX_POINTS,
): ReadingPoint[] {
  const byTimestamp = new Map<number, ReadingPoint>();

  for (const point of existing) {
    byTimestamp.set(point.ts, point);
  }

  for (const point of incoming) {
    byTimestamp.set(point.ts, point);
  }

  return [...byTimestamp.values()].sort((left, right) => left.ts - right.ts).slice(-limit);
}

export function latestPoint(points: ReadingPoint[]): ReadingPoint | null {
  return points.length === 0 ? null : (points[points.length - 1] ?? null);
}

export function valueAtOrBefore(points: ReadingPoint[], timestamp: number): ReadingPoint | null {
  let candidate: ReadingPoint | null = null;

  for (const point of points) {
    if (point.ts > timestamp) {
      break;
    }

    candidate = point;
  }

  return candidate;
}

export function countPointsInWindow(points: ReadingPoint[], from: number, to: number): number {
  let count = 0;

  for (const point of points) {
    if (point.ts >= from && point.ts < to) {
      count += 1;
    }
  }

  return count;
}

export interface RateComparison {
  current: number;
  previous: number;
}

export function ratePerMinute(points: ReadingPoint[], now: number): RateComparison {
  return {
    current: countPointsInWindow(points, now - 60_000, now + 1),
    previous: countPointsInWindow(points, now - 120_000, now - 60_000),
  };
}

export function temperatureDelta(
  points: ReadingPoint[],
  windowMs: number = 5 * 60 * 1000,
): number | null {
  const latest = latestPoint(points);

  if (latest === null) {
    return null;
  }

  const baseline = valueAtOrBefore(points, latest.ts - windowMs);

  if (baseline === null || baseline.ts === latest.ts) {
    return null;
  }

  return latest.temperature - baseline.temperature;
}

export function nextReconnectDelay(current: number, maximum: number = RECONNECT_MAX_MS): number {
  return Math.min(current * 2, maximum);
}
