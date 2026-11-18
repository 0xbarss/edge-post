import type { Device, Theme } from '../types';
import { ConnectionPill } from './StatusPill';

interface TopBarProps {
  device: Device | null;
  connection: 'connecting' | 'open' | 'closed';
  offlineCount: number;
  theme: Theme;
  onToggleTheme: () => void;
}

export function TopBar({ device, connection, offlineCount, theme, onToggleTheme }: TopBarProps) {
  return (
    <header className="topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb navigation">
        <span className="breadcrumb__root">Fleet Dashboard</span>
        <span className="breadcrumb__sep" aria-hidden="true">
          /
        </span>
        <span className="breadcrumb__current">
          {device === null ? 'Select Node' : device.name}
          {device !== null && <span className="breadcrumb__id mono">#{device.deviceId}</span>}
        </span>
      </nav>

      <div className="topbar__tools">
        <ConnectionPill state={connection} />

        <span className="topbar__divider" aria-hidden="true" />

        <a
          className="icon-button notification-button"
          href="#fleet-health"
          aria-label={
            offlineCount === 0
              ? 'Fleet health: all nodes online'
              : `Fleet health: ${offlineCount} offline`
          }
          title={offlineCount === 0 ? 'All nodes reporting' : `${offlineCount} node(s) offline`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.7"
              d="M12 3.75a5.25 5.25 0 0 0-5.25 5.25v3.1l-1.6 2.8a.9.9 0 0 0 .78 1.35h12.14a.9.9 0 0 0 .78-1.35l-1.6-2.8v-3.1A5.25 5.25 0 0 0 12 3.75Z"
            />
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.7"
              d="M9.9 18.3a2.2 2.2 0 0 0 4.2 0"
            />
          </svg>
          {offlineCount > 0 && <span className="notification-badge">{offlineCount}</span>}
        </a>

        <button
          type="button"
          className="icon-button theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? (
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="12" cy="12" r="4.1" />
              <path
                strokeLinecap="round"
                d="M12 2.8v2.3M12 18.9v2.3M2.8 12h2.3M18.9 12h2.3M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6"
              />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.2 14.4A8.4 8.4 0 0 1 9.6 3.8a8.4 8.4 0 1 0 10.6 10.6Z"
              />
            </svg>
          )}
        </button>

        <div className="operator" title="Authenticated Operator">
          <div className="operator__avatar">
            <span>OP</span>
            <span className="operator__status" aria-hidden="true" />
          </div>
          <div className="operator__meta">
            <span className="operator__name">Operator</span>
            <span className="operator__role">Local Console</span>
          </div>
        </div>
      </div>
    </header>
  );
}
