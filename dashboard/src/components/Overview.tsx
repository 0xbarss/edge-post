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

function trendTone(value: number): string {
  return value === 0 ? 'neutral' : value > 0 ? 'positive' : 'warning';
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
  const deltaTone =
    temperatureChange === null || Math.abs(temperatureChange) < 0.05
      ? 'neutral'
      : temperatureChange > 0
        ? 'warning'
        : 'positive';

  return (
    <section className="overview" aria-label="Live fleet metrics">
      <div className="overview__cell overview__cell--temperature">
        <p className="overview__label">Temperature</p>
        <p className="overview__value">
          {temperature === null ? '—' : temperature.toFixed(1)}
          <span>°C</span>
        </p>
        <p className="overview__note" data-tone={deltaTone}>
          {formatTemperatureDelta(temperatureChange)}
        </p>
        <Sparkline points={points.slice(-48)} className="overview__spark" />
      </div>

      <div className="overview__cell">
        <p className="overview__label">Throughput</p>
        <p className="overview__value">
          {throughput}
          <span>/min</span>
        </p>
        <p className="overview__note" data-tone={trendTone(throughputDelta)}>
          {throughputDelta === 0
            ? 'matching previous minute'
            : `${throughputDelta > 0 ? '+' : '−'}${Math.abs(throughputDelta)} vs previous minute`}
        </p>
        <div className="overview__meter" aria-hidden="true">
          <span
            style={{
              width: `${expectedRate === 0 ? 0 : Math.min(100, (throughput / expectedRate) * 100)}%`,
            }}
          />
        </div>
      </div>

      <div className="overview__cell">
        <p className="overview__label">Fleet online</p>
        <p className="overview__value">
          {online}
          <span>/{devices.length}</span>
        </p>
        <p className="overview__note" data-tone={offline === 0 ? 'positive' : 'negative'}>
          {offline === 0 ? 'no presence gaps' : `${offline} offline now`}
        </p>
        <div className="overview__ticks" aria-hidden="true">
          {devices.slice(0, 24).map((device) => (
            <span key={device.deviceId} data-status={device.status} />
          ))}
        </div>
      </div>

      <div className="overview__cell">
        <p className="overview__label">GPIO bitmask</p>
        <p className="overview__value overview__value--mono">
          {gpioMask === null ? '—' : formatGpio(gpioMask)}
        </p>
        <p className="overview__note">
          {pins.length === 0 ? 'all pins low' : `pins ${pins.join(', ')} high`}
        </p>
        <div className="pin-leds" aria-hidden="true">
          {Array.from({ length: 8 }, (_, pin) => (
            <span key={pin} data-high={pins.includes(pin)} />
          ))}
        </div>
      </div>
    </section>
  );
}
