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
    <section className="rail-block rail-health" id="fleet-health" aria-labelledby="fleet-title">
      <div className="rail-block__head">
        <h2 id="fleet-title">Presence</h2>
        <span className="mono">
          {online.length}/{devices.length}
        </span>
      </div>

      <div
        className="presence-bar"
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

      <dl className="presence-stats">
        <div>
          <dt>Expected</dt>
          <dd>{expectedPerMinute.toFixed(0)}/min</dd>
        </div>
        <div>
          <dt>Oldest</dt>
          <dd>
            {oldestContact === null
              ? '—'
              : formatRelativeTime(Date.parse(oldestContact.lastSeen), now)}
          </dd>
        </div>
        <div>
          <dt>Timeout</dt>
          <dd>15 s</dd>
        </div>
      </dl>

      <div className="presence-offline">
        <h3>Offline</h3>
        {offline.length === 0 ? (
          <p className="presence-offline__empty">Every registered node is reporting.</p>
        ) : (
          <ul>
            {offline.map((device) => (
              <li key={device.deviceId}>
                <span className="device-led" data-status="offline" aria-hidden="true" />
                <span className="presence-offline__name">{device.name}</span>
                <span className="presence-offline__time">
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
