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

export function RecentReadings({ readings, deviceName }: RecentReadingsProps) {
  return (
    <section className="panel readings-panel" aria-labelledby="readings-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Frame ledger</p>
          <h2 id="readings-title">Recent readings</h2>
          <p className="panel-sub">
            {deviceName === null ? 'No node selected' : `Newest frames from ${deviceName}`}
          </p>
        </div>
        <span className="count-badge">{readings.length}</span>
      </div>

      {readings.length === 0 ? (
        <p className="readings-empty">
          No frames in the current window. The log fills as live readings arrive.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Recent temperature and GPIO readings</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col" className="numeric">
                  Temp
                </th>
                <th scope="col" className="numeric">
                  Δ
                </th>
                <th scope="col" className="numeric">
                  GPIO
                </th>
              </tr>
            </thead>
            <tbody>
              {readings.map((reading, index) => (
                <tr key={`${reading.ts}-${index}`}>
                  <td className="mono">{formatClock(reading.ts)}</td>
                  <td className="numeric mono">{reading.temperature.toFixed(1)}°</td>
                  <td className="numeric mono muted">
                    {formatDelta(reading.temperature, readings[index + 1]?.temperature)}
                  </td>
                  <td className="numeric mono">{formatGpio(reading.gpioState)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
