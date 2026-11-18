import { formatGpio, formatTemperatureDelta } from '../format';
import type { Device, ReadingPoint } from '../types';
import { Sparkline } from './Sparkline';

interface OverviewProps {
  points: ReadingPoint[];
  temperature: number | null;
  temperatureChange: number | null;
  throughput: number;
  throughputDelta: number;
  expectedRate: number;
  devices: Device[];
  gpioMask: number | null;
  pins: number[];
}

export function Overview({
  points,
  temperature,
  temperatureChange,
  throughput,
  throughputDelta,
  expectedRate,
  devices,
  gpioMask,
  pins,
}: OverviewProps) {
  const online = devices.filter((device) => device.status === 'online').length;
  const offline = devices.length - online;

  const tempTone =
    temperatureChange === null || Math.abs(temperatureChange) < 0.05
      ? 'neutral'
      : temperatureChange > 0
        ? 'warning'
        : 'positive';

  const tempArrow =
    temperatureChange === null || Math.abs(temperatureChange) < 0.05
      ? '→'
      : temperatureChange > 0
        ? '↑'
        : '↓';

  const throughputTone =
    throughputDelta === 0 ? 'neutral' : throughputDelta > 0 ? 'positive' : 'warning';
  const throughputArrow = throughputDelta > 0 ? '↑' : throughputDelta < 0 ? '↓' : '→';

  const throughputPct =
    expectedRate === 0 ? 0 : Math.min(100, Math.round((throughput / expectedRate) * 100));

  return (
    <section className="kpi-grid" aria-label="Key telemetry metrics">
      {/* 1. Temperature KPI Card */}
      <div className="kpi-card kpi-card--lead">
        <div className="kpi-card__header">
          <span className="kpi-card__label">Temperature</span>
          <span className="kpi-pill" data-tone={tempTone}>
            <span className="kpi-pill__arrow" aria-hidden="true">
              {tempArrow}
            </span>
            {formatTemperatureDelta(temperatureChange)}
          </span>
        </div>

        <div className="kpi-card__body">
          <div className="kpi-card__stat">
            <span className="kpi-card__number">
              {temperature === null ? '—' : temperature.toFixed(1)}
            </span>
            <span className="kpi-card__unit">°C</span>
          </div>
          <div className="kpi-card__chart">
            <Sparkline points={points.slice(-48)} className="kpi-sparkline" />
          </div>
        </div>

        <div className="kpi-card__footer">
          <span className="kpi-card__hint">
            {points.length > 0 ? `${points.length} samples recorded` : 'Awaiting sensor stream'}
          </span>
        </div>
      </div>

      {/* 2. Throughput KPI Card */}
      <div className="kpi-card">
        <div className="kpi-card__header">
          <span className="kpi-card__label">Throughput</span>
          <span className="kpi-pill" data-tone={throughputTone}>
            <span className="kpi-pill__arrow" aria-hidden="true">
              {throughputArrow}
            </span>
            {throughputDelta === 0
              ? 'Flat'
              : `${throughputDelta > 0 ? '+' : '−'}${Math.abs(throughputDelta)} /min`}
          </span>
        </div>

        <div className="kpi-card__body">
          <div className="kpi-card__stat">
            <span className="kpi-card__number">{throughput}</span>
            <span className="kpi-card__unit">/min</span>
          </div>
          <span className="kpi-card__subtext">
            Target: {expectedRate.toFixed(0)}/min ({throughputPct}%)
          </span>
        </div>

        <div className="kpi-card__footer">
          <div
            className="kpi-progress"
            role="progressbar"
            aria-valuenow={throughputPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Throughput vs target"
          >
            <div className="kpi-progress__bar" style={{ width: `${throughputPct}%` }} />
          </div>
        </div>
      </div>

      {/* 3. Fleet Online KPI Card */}
      <div className="kpi-card">
        <div className="kpi-card__header">
          <span className="kpi-card__label">Fleet Connectivity</span>
          <span className="kpi-pill" data-tone={offline === 0 ? 'positive' : 'negative'}>
            <span className="status-dot" aria-hidden="true" />
            {offline === 0 ? 'All Nominal' : `${offline} Degraded`}
          </span>
        </div>

        <div className="kpi-card__body">
          <div className="kpi-card__stat">
            <span className="kpi-card__number">{online}</span>
            <span className="kpi-card__unit">/{devices.length} Online</span>
          </div>
          <span className="kpi-card__subtext">
            {offline === 0 ? 'Zero connectivity gaps' : `${offline} node(s) currently offline`}
          </span>
        </div>

        <div className="kpi-card__footer">
          <div className="fleet-segments" aria-hidden="true">
            {devices.slice(0, 16).map((device) => (
              <span
                key={device.deviceId}
                className="fleet-segment"
                data-status={device.status}
                title={`${device.name}: ${device.status}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 4. GPIO State KPI Card */}
      <div className="kpi-card">
        <div className="kpi-card__header">
          <span className="kpi-card__label">GPIO Bus State</span>
          <span className="kpi-pill" data-tone={pins.length > 0 ? 'active' : 'neutral'}>
            {pins.length === 0 ? 'All Low' : `${pins.length} High`}
          </span>
        </div>

        <div className="kpi-card__body">
          <div className="kpi-card__stat">
            <code className="kpi-card__code">
              {gpioMask === null ? '00000000' : formatGpio(gpioMask)}
            </code>
          </div>
          <span className="kpi-card__subtext">
            {pins.length === 0 ? 'No active output lines' : `Lines active: pin ${pins.join(', ')}`}
          </span>
        </div>

        <div className="kpi-card__footer">
          <div className="pin-indicators" aria-label="Pins 0 through 7">
            {Array.from({ length: 8 }, (_, pinIndex) => {
              const isHigh = pins.includes(pinIndex);
              return (
                <span
                  key={pinIndex}
                  className={`pin-indicator ${isHigh ? 'pin-indicator--high' : ''}`}
                  title={`Pin ${pinIndex}: ${isHigh ? 'HIGH' : 'LOW'}`}
                >
                  {pinIndex}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
