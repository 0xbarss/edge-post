import { formatClock, formatGpio } from '../format';
import type { RecentReading } from '../types';

interface RecentReadingsProps {
  readings: RecentReading[];
  deviceName: string | null;
}

function formatDelta(current: number, previous: number | undefined): string {
  if (previous === undefined) {
    return '—';
  }

  const delta = current - previous;

  if (Math.abs(delta) < 0.05) {
    return '0.0°';
  }

  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}°`;
}

function deltaSign(
  current: number,
  previous: number | undefined,
): 'positive' | 'negative' | 'neutral' {
  if (previous === undefined) {
    return 'neutral';
  }
  const delta = current - previous;
  if (Math.abs(delta) < 0.05) {
    return 'neutral';
  }
  return delta > 0 ? 'positive' : 'negative';
}

export function RecentReadings({ readings, deviceName }: RecentReadingsProps) {
  return (
    <section className="panel readings-panel" aria-labelledby="readings-title">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Data Stream</span>
          <h2 id="readings-title" className="panel-title">
            Recent Telemetry Frames
          </h2>
          <p className="panel-sub">
            {deviceName === null
              ? 'No node selected'
              : `Newest telemetry transmissions logged from ${deviceName}`}
          </p>
        </div>
        <span className="panel-count mono">{readings.length} frames</span>
      </div>

      {readings.length === 0 ? (
        <div className="readings-empty">
          <svg
            className="readings-empty__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p>
            No frames in the current window. Awaiting incoming packets on the TCP telemetry ingest.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Recent temperature and GPIO readings</caption>
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col" className="numeric">
                  Temperature
                </th>
                <th scope="col" className="numeric">
                  Step Delta
                </th>
                <th scope="col" className="numeric">
                  GPIO Bitmask
                </th>
              </tr>
            </thead>
            <tbody>
              {readings.map((reading, index) => {
                const prev = readings[index + 1]?.temperature;
                const sign = deltaSign(reading.temperature, prev);
                return (
                  <tr
                    key={`${reading.ts}-${index}`}
                    className={index === 0 ? 'data-row--fresh' : undefined}
                  >
                    <td className="mono data-table__time">
                      {formatClock(reading.ts)}
                      {index === 0 && <span className="fresh-indicator">Latest</span>}
                    </td>
                    <td className="numeric mono data-table__temp">
                      {reading.temperature.toFixed(1)}°C
                    </td>
                    <td className="numeric mono" data-tone={sign}>
                      {formatDelta(reading.temperature, prev)}
                    </td>
                    <td className="numeric mono">
                      <span className="gpio-bitmask-cell">{formatGpio(reading.gpioState)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
