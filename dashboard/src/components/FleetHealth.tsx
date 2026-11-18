import { formatRelativeTime } from '../format';
import type { Device } from '../types';

interface FleetHealthProps {
  devices: Device[];
  now: number;
}

export function FleetHealth({ devices, now }: FleetHealthProps) {
  const online = devices.filter((device) => device.status === 'online');
  const offline = devices.filter((device) => device.status === 'offline');
  const expectedPerMinute = devices.reduce(
    (total, device) => total + 60 / Math.max(device.sampleRate, 1),
    0,
  );
  const oldestContact = devices.reduce<Device | null>((oldest, device) => {
    if (oldest === null) {
      return device;
    }

    return Date.parse(device.lastSeen) < Date.parse(oldest.lastSeen) ? device : oldest;
  }, null);

  return (
    <section className="panel fleet-panel" id="fleet-health" aria-labelledby="fleet-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Presence</p>
          <h2 id="fleet-title">Fleet</h2>
        </div>
      </div>

      <div className="fleet-figure">
        <strong>
          {online.length}
          <span>/{devices.length}</span>
        </strong>
        <p>
          nodes reporting
          <small>15 s presence window</small>
        </p>
      </div>

      <div
        className="fleet-matrix"
        role="img"
        aria-label={`${online.length} of ${devices.length} devices online`}
      >
        {devices.slice(0, 24).map((device) => (
          <span
            key={device.deviceId}
            data-status={device.status}
            title={`${device.name} · ${device.status}`}
          />
        ))}
      </div>

      <dl className="fleet-rows">
        <div>
          <dt>Expected ingest</dt>
          <dd>{expectedPerMinute.toFixed(0)}/min</dd>
        </div>
        <div>
          <dt>Oldest contact</dt>
          <dd>
            {oldestContact === null
              ? '—'
              : formatRelativeTime(Date.parse(oldestContact.lastSeen), now)}
          </dd>
        </div>
        <div>
          <dt>Presence timeout</dt>
          <dd>15 s</dd>
        </div>
      </dl>

      <div className="offline-list">
        <h3>Offline nodes</h3>
        {offline.length === 0 ? (
          <p className="offline-list__empty">Every registered node is reporting.</p>
        ) : (
          <ul>
            {offline.map((device) => (
              <li key={device.deviceId}>
                <span className="status-dot status-dot--offline" aria-hidden="true" />
                <span>{device.name}</span>
                <span className="mono">#{device.deviceId}</span>
                <span className="offline-list__time">
                  {formatRelativeTime(Date.parse(device.lastSeen), now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
