import { CommandConsole } from './components/CommandConsole';
import { DeviceList } from './components/DeviceList';
import { FleetHealth } from './components/FleetHealth';
import { Masthead } from './components/Masthead';
import { Overview } from './components/Overview';
import { RecentReadings } from './components/RecentReadings';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { TrendChart } from './components/TrendChart';
import { latestPoint, ratePerMinute, temperatureDelta } from './telemetry';
import { useNow } from './useNow';
import { useTelemetry } from './useTelemetry';
import { useTheme } from './useTheme';

function highPins(mask: number): number[] {
  const pins: number[] = [];

  for (let pin = 0; pin < 8; pin += 1) {
    if ((mask & (1 << pin)) !== 0) {
      pins.push(pin);
    }
  }

  return pins;
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const now = useNow();
  const telemetry = useTelemetry();

  const {
    devices,
    devicesError,
    selectedDevice,
    selectedDeviceId,
    selectDevice,
    points,
    recent,
    latestByDevice,
    connection,
    lastEventAt,
    rangeMs,
    setRangeMs,
    commands,
    sendCommand,
    notice,
    dismissNotice,
    refreshDevices,
  } = telemetry;

  const latest = latestPoint(points);
  const temperatureChange = temperatureDelta(points);
  const throughput = ratePerMinute(points, now);
  const throughputDelta = throughput.current - throughput.previous;
  const onlineCount = devices.filter((device) => device.status === 'online').length;
  const offlineCount = devices.length - onlineCount;
  const latestReading = recent[0] ?? null;
  const gpioMask = latestReading?.gpioState ?? null;
  const pins = gpioMask === null ? [] : highPins(gpioMask);
  const expectedRate = selectedDevice === null ? 0 : 60 / Math.max(selectedDevice.sampleRate, 1);

  const queueToggle = (pin: number, state: 0 | 1): Promise<boolean> => {
    if (selectedDeviceId === null) {
      return Promise.resolve(false);
    }

    return sendCommand({
      deviceId: selectedDeviceId,
      type: 'toggle_gpio',
      payload: { pin, state },
    });
  };

  const queueSampleRate = (seconds: number): Promise<boolean> => {
    if (selectedDeviceId === null) {
      return Promise.resolve(false);
    }

    return sendCommand({
      deviceId: selectedDeviceId,
      type: 'set_sample_rate',
      payload: { seconds },
    });
  };

  const feedLabel =
    connection === 'open'
      ? 'Live Feed Connected'
      : connection === 'connecting'
        ? 'Connecting to Feed'
        : 'Feed Reconnecting';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to telemetry
      </a>

      <aside className="rail">
        <div className="brand">
          <div className="brand__logo" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 9a8 8 0 0 1 16 0" />
              <path d="M7 9a5 5 0 0 1 10 0" />
              <circle cx="12" cy="9" r="1.8" fill="currentColor" stroke="none" />
              <path d="M12 11v10" />
              <path d="M9.5 16h5" />
              <path d="M8 21h8" />
            </svg>
          </div>
          <div className="brand__info">
            <strong className="brand__title">Edge Post</strong>
            <span className="brand__badge">Operator Console</span>
          </div>
        </div>

        <DeviceList
          devices={devices}
          selectedId={selectedDeviceId}
          latestByDevice={latestByDevice}
          now={now}
          onSelect={selectDevice}
        />

        <FleetHealth devices={devices} now={now} />

        <div className="rail-status" data-state={connection}>
          <span
            className={`status-dot ${connection === 'open' ? 'status-dot--online' : 'status-dot--offline'}`}
            aria-hidden="true"
          />
          <div className="rail-status__meta">
            <strong className="rail-status__title">{feedLabel}</strong>
            <span className="rail-status__sub mono">{devices.length} nodes • /ws</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <TopBar
          device={selectedDevice}
          connection={connection}
          offlineCount={offlineCount}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <main className="content" id="main">
          <Masthead
            device={selectedDevice}
            lastEventAt={lastEventAt ?? latestReading?.ts ?? null}
            now={now}
          />

          {devicesError !== null && (
            <div className="banner" role="alert">
              <span>
                <strong>Device list unavailable.</strong> {devicesError}
              </span>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  void refreshDevices();
                }}
              >
                Retry
              </button>
            </div>
          )}

          <div className="section-header">
            <div>
              <h2 className="section-header__title">Telemetry Overview</h2>
              <p className="section-header__subtitle">
                Continuous telemetry readings and fleet-wide sensor health
              </p>
            </div>
            <div className="section-header__meta">
              <span className="meta-pill mono">
                <span className="status-dot status-dot--online" aria-hidden="true" />
                {onlineCount} Online
              </span>
              <span className="meta-pill mono">{devices.length} Total Nodes</span>
            </div>
          </div>

          <Overview
            points={points}
            temperature={latest?.temperature ?? null}
            temperatureChange={temperatureChange}
            throughput={throughput.current}
            throughputDelta={throughputDelta}
            expectedRate={expectedRate}
            devices={devices}
            gpioMask={gpioMask}
            pins={pins}
          />

          <div className="console-grid">
            <div className="console-main">
              <TrendChart
                device={selectedDevice}
                points={points}
                now={now}
                rangeMs={rangeMs}
                onRangeChange={setRangeMs}
              />
            </div>

            <aside className="console-side" aria-label="Hardware Operations">
              <CommandConsole
                key={selectedDeviceId ?? 'no-device'}
                device={selectedDevice}
                commands={commands}
                now={now}
                onToggleGpio={queueToggle}
                onSetSampleRate={queueSampleRate}
              />
            </aside>
          </div>

          <RecentReadings readings={recent} deviceName={selectedDevice?.name ?? null} />

          <footer className="page-footer">
            <div className="page-footer__brand">
              <span>Edge Post Platform</span>
              <span className="sep-dot" aria-hidden="true">
                •
              </span>
              <span>Realtime Embedded Operations Console</span>
            </div>
            <div className="page-footer__meta mono">
              <span>
                Fleet: {onlineCount}/{devices.length} Active
              </span>
              <span className="sep-dot" aria-hidden="true">
                •
              </span>
              <span>WebSocket Telemetry Ingest</span>
            </div>
          </footer>
        </main>
      </div>

      <Toast notice={notice} onDismiss={dismissNotice} />
    </div>
  );
}
