import type { Pool } from 'pg';

import { markAllDevicesOffline, markDevicesOffline, sweepPresence } from './db.js';
import type { Logger } from './logger.js';
import type { LiveEventSink } from './models.js';

export const PRESENCE_SWEEP_INTERVAL_MS = 5_000;
export const PRESENCE_MINIMUM_TIMEOUT_SECONDS = 15;
export const PRESENCE_SAMPLE_MULTIPLIER = 3;

export function presenceTimeoutSeconds(sampleRate: number): number {
  return Math.max(PRESENCE_SAMPLE_MULTIPLIER * sampleRate, PRESENCE_MINIMUM_TIMEOUT_SECONDS);
}

export class Presence {
  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger,
    private readonly live?: LiveEventSink,
  ) {}

  async resetOnStartup(): Promise<number> {
    const count = await markAllDevicesOffline(this.pool);
    this.logger.info({ count }, 'devices reset to offline on startup');
    return count;
  }

  async markOffline(deviceIds: Iterable<number>): Promise<number[]> {
    const uniqueIds = [...new Set(deviceIds)];

    if (uniqueIds.length === 0) {
      return [];
    }

    const changed = await markDevicesOffline(this.pool, uniqueIds);

    if (changed.length > 0) {
      this.logger.info({ deviceIds: changed }, 'devices marked offline');
      this.publishOffline(changed);
    }

    return changed;
  }

  async sweepNow(now: Date = new Date()): Promise<number[]> {
    const changed = await sweepPresence(this.pool, now);

    if (changed.length > 0) {
      this.logger.info({ deviceIds: changed }, 'devices marked offline by sweep');
      this.publishOffline(changed);
    }

    return changed;
  }

  startSweep(intervalMs: number = PRESENCE_SWEEP_INTERVAL_MS): () => void {
    let running = false;

    const timer = setInterval(() => {
      if (running) {
        return;
      }

      running = true;
      void this.sweepOnce().finally(() => {
        running = false;
      });
    }, intervalMs);

    timer.unref();

    return () => {
      clearInterval(timer);
    };
  }

  private async sweepOnce(): Promise<void> {
    try {
      await this.sweepNow();
    } catch (error) {
      this.logger.error({ err: error }, 'presence sweep failed');
    }
  }

  private publishOffline(deviceIds: number[]): void {
    for (const deviceId of deviceIds) {
      this.live?.publishStatus(deviceId, 'offline');
    }
  }
}
