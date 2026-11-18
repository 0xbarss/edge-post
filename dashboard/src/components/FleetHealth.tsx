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
        <h2 id="fleet-title">Fleet Presence</h2>
        <span className="presence-fraction mono">
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
            className="presence-bar__segment"
            data-status={device.status}
            title={`${device.name} • ${device.status}`}
          />
        ))}
      </div>

      <div className="presence-stats-grid">
        <div className="presence-stat-box">
          <span className="presence-stat-box__label">Expected Ingest</span>
          <span className="presence-stat-box__value mono">{expectedPerMinute.toFixed(0)}/min</span>
        </div>
        <div className="presence-stat-box">
          <span className="presence-stat-box__label">Heartbeat Timeout</span>
          <span className="presence-stat-box__value mono">15s</span>
        </div>
      </div>

      {oldestContact && (
        <div className="presence-oldest">
          <span className="presence-oldest__label">Oldest Signal</span>
          <span className="presence-oldest__val mono">
            {formatRelativeTime(Date.parse(oldestContact.lastSeen), now)}
          </span>
        </div>
      )}

      {offline.length > 0 && (
        <div className="presence-offline">
          <div className="presence-offline__head">
            <h3>Offline Nodes</h3>
            <span className="presence-offline__count">{offline.length}</span>
          </div>
          <ul className="presence-offline__list">
            {offline.map((device) => (
              <li key={device.deviceId} className="presence-offline__item">
                <span className="device-led" data-status="offline" aria-hidden="true" />
                <span className="presence-offline__name">{device.name}</span>
                <span className="presence-offline__time mono">
                  {formatRelativeTime(Date.parse(device.lastSeen), now)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
