import type { ConnectionState, DeviceStatus } from '../types';

export function StatusPill({ status }: { status: DeviceStatus }) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  open: 'Live link',
  closed: 'Reconnecting',
};

export function ConnectionPill({ state }: { state: ConnectionState }) {
  return (
    <span className={`status-pill status-pill--connection-${state}`}>
      <span className="status-dot" aria-hidden="true" />
      {CONNECTION_LABELS[state]}
    </span>
  );
}
