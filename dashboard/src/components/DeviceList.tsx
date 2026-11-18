import { useMemo, useState } from 'react';

import { formatRelativeTime, formatTemperature } from '../format';
import type { Device } from '../types';
import type { LatestReading } from '../useTelemetry';

interface DeviceListProps {
  devices: Device[];
  selectedId: number | null;
  latestByDevice: Record<number, LatestReading>;
  now: number;
  onSelect: (deviceId: number) => void;
}

export function DeviceList({
  devices,
  selectedId,
  latestByDevice,
  now,
  onSelect,
}: DeviceListProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      devices.filter(
        (device) =>
          normalizedQuery === '' ||
          device.name.toLowerCase().includes(normalizedQuery) ||
          String(device.deviceId).includes(normalizedQuery),
      ),
    [devices, normalizedQuery],
  );

  return (
    <section className="device-panel" aria-labelledby="device-panel-title">
      <div className="device-panel__heading">
        <h2 id="device-panel-title">Fleet index</h2>
        <span className="count-badge">{devices.length}</span>
      </div>

      <label className="search-field">
        <span className="visually-hidden">Filter devices</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="8.6" cy="8.6" r="4.8" />
          <path d="m12.2 12.2 4 4" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Find a node"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {filtered.length === 0 ? (
        <p className="device-panel__empty">
          {devices.length === 0
            ? 'No devices have reported yet. Send a frame to the TCP ingest port.'
            : 'No device matches that filter.'}
        </p>
      ) : (
        <div className="device-list" role="group" aria-label="Select a device">
          {filtered.map((device) => {
            const latest = latestByDevice[device.deviceId];
            const selected = device.deviceId === selectedId;

            return (
              <button
                key={device.deviceId}
                type="button"
                className={`device-row${selected ? ' device-row--selected' : ''}`}
                aria-pressed={selected}
                onClick={() => {
                  onSelect(device.deviceId);
                }}
              >
                <span
                  className={`status-dot status-dot--${device.status}`}
                  aria-label={device.status}
                  role="img"
                />
                <span className="device-row__body">
                  <span className="device-row__name">{device.name}</span>
                  <span className="device-row__meta">
                    <span className="mono">#{device.deviceId}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeTime(Date.parse(device.lastSeen), now)}</span>
                  </span>
                </span>
                <span className="device-row__reading">
                  <span className="device-row__temp">
                    {formatTemperature(latest?.temperature ?? null)}
                  </span>
                  <span className="device-row__rate">{device.sampleRate}s</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
