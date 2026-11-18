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
      ? 'Live feed connected'
      : connection === 'connecting'
        ? 'Connecting to feed'
        : 'Feed reconnecting';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to telemetry
      </a>

      <aside className="rail">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false">
              <path d="M3 19.5h6.5l3-9 5 16 3.5-7H29" />
            </svg>
          </span>
          <span className="brand__copy">
            <strong>Edge Post</strong>
            <small>Local workspace</small>
          </span>
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
          <span>
            <strong>{feedLabel}</strong>
            <small>{devices.length} nodes · ws /ws</small>
          </span>
          <span className="rail-status__version">v0.1</span>
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

          <div className="section-rule">
            <span className="section-index mono">02</span>
            <h2 className="section-rule__title">Live readout</h2>
            <span className="section-rule__meta mono">
              {onlineCount} online · {devices.length} registered
            </span>
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

            <aside className="console-side" aria-label="Operations">
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
            <span>Edge Post · operator console</span>
            <span>
              {onlineCount} online · {devices.length} registered · ws /ws
            </span>
          </footer>
        </main>
      </div>

      <Toast notice={notice} onDismiss={dismissNotice} />
    </div>
  );
}
