import { formatDate, formatRelativeTime } from '../format';
import type { Device } from '../types';
import { StatusPill } from './StatusPill';

interface MastheadProps {
  device: Device | null;
  lastEventAt: number | null;
  now: number;
}

export function Masthead({ device, lastEventAt, now }: MastheadProps) {
  return (
    <header className="device-header">
      <div className="device-header__main">
        <div className="device-header__badge-row">
          <span className="device-header__tag">Active Node</span>
          {device !== null && <span className="device-header__node-id">#{device.deviceId}</span>}
        </div>

        <h1 className="device-header__title">
          {device === null ? 'No node selected' : device.name}
        </h1>

        <p className="device-header__desc">
          {device === null ? (
            'Choose a node from the fleet sidebar to inspect live telemetry and dispatch controls.'
          ) : (
            <>
              <span>Edge sensor station</span>
              <span className="sep-dot" aria-hidden="true">
                •
              </span>
              <span>{device.sampleRate}s sample interval</span>
              <span className="sep-dot" aria-hidden="true">
                •
              </span>
              <span>Registered {formatDate(Date.parse(device.firstSeen))}</span>
            </>
          )}
        </p>
      </div>

      <div className="device-header__metrics">
        <div className="metric-badge">
          <span className="metric-badge__label">Node State</span>
          <div className="metric-badge__value">
            {device === null ? (
              <span className="muted">—</span>
            ) : (
              <StatusPill status={device.status} />
            )}
          </div>
        </div>

        <div className="metric-badge">
          <span className="metric-badge__label">Last Telemetry</span>
          <span className="metric-badge__value mono">{formatRelativeTime(lastEventAt, now)}</span>
        </div>

        <div className="metric-badge">
          <span className="metric-badge__label">System Clock</span>
          <span className="metric-badge__value mono">
            {new Date(now).toLocaleTimeString('en-GB', { hour12: false })}
          </span>
        </div>
      </div>
    </header>
  );
}
