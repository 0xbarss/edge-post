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
    <header className="masthead">
      <div className="masthead__identity">
        <p className="masthead__eyebrow">
          <span>Node</span>
          <span className="masthead__slash" aria-hidden="true">
            /
          </span>
          <span className="mono">{device === null ? '—' : `#${device.deviceId}`}</span>
        </p>

        <h1>{device === null ? 'No node selected' : device.name}</h1>

        <p className="masthead__meta">
          {device === null ? (
            'Choose a node from the fleet index to inspect its signal and controls.'
          ) : (
            <>
              Edge sensor post
              <span aria-hidden="true"> · </span>
              {device.sampleRate} s sample interval
              <span aria-hidden="true"> · </span>
              first seen {formatDate(Date.parse(device.firstSeen))}
            </>
          )}
        </p>
      </div>

      <dl className="masthead__facts">
        <div>
          <dt>State</dt>
          <dd>{device === null ? '—' : <StatusPill status={device.status} />}</dd>
        </div>
        <div>
          <dt>Last frame</dt>
          <dd>{formatRelativeTime(lastEventAt, now)}</dd>
        </div>
        <div>
          <dt>Local time</dt>
          <dd className="mono">{new Date(now).toLocaleTimeString('en-GB', { hour12: false })}</dd>
        </div>
      </dl>
    </header>
  );
}
