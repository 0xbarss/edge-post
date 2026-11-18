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
    <section className="readout" aria-label="Live fleet metrics">
      <div className="readout__cell readout__cell--lead">
        <div className="readout__head">
          <p className="readout__label">Temperature</p>
          <span className="readout__mark" aria-hidden="true" />
        </div>
        <p className="readout__value">
          {temperature === null ? '—' : temperature.toFixed(1)}
          <span>°C</span>
        </p>
        <p className="readout__note" data-tone={deltaTone}>
          {formatTemperatureDelta(temperatureChange)}
        </p>
        <Sparkline points={points.slice(-48)} className="readout__spark" />
      </div>

      <div className="readout__cell">
        <p className="readout__label">Throughput</p>
        <p className="readout__value">
          {throughput}
          <span>/min</span>
        </p>
        <p className="readout__note" data-tone={trendTone(throughputDelta)}>
          {throughputDelta === 0
            ? 'matching previous minute'
            : `${throughputDelta > 0 ? '+' : '−'}${Math.abs(throughputDelta)} vs previous minute`}
        </p>
        <div className="readout__meter" aria-hidden="true">
          <span
            style={{
              width: `${expectedRate === 0 ? 0 : Math.min(100, (throughput / expectedRate) * 100)}%`,
            }}
          />
        </div>
      </div>

      <div className="readout__cell">
        <p className="readout__label">Fleet online</p>
        <p className="readout__value">
          {online}
          <span>/{devices.length}</span>
        </p>
        <p className="readout__note" data-tone={offline === 0 ? 'positive' : 'negative'}>
          {offline === 0 ? 'no presence gaps' : `${offline} offline now`}
        </p>
        <div className="readout__ticks" aria-hidden="true">
          {devices.slice(0, 24).map((device) => (
            <span key={device.deviceId} data-status={device.status} />
          ))}
        </div>
      </div>

      <div className="readout__cell">
        <p className="readout__label">GPIO bitmask</p>
        <p className="readout__value readout__value--mono">
          {gpioMask === null ? '—' : formatGpio(gpioMask)}
        </p>
        <p className="readout__note">
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
