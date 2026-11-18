import { useState } from 'react';

import { formatRelativeTime } from '../format';
import type { CommandRow, Device } from '../types';

interface CommandConsoleProps {
  device: Device | null;
  commands: CommandRow[];
  now: number;
  onToggleGpio: (pin: number, state: 0 | 1) => Promise<boolean>;
  onSetSampleRate: (seconds: number) => Promise<boolean>;
}

const PINS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const SAMPLE_RATE_MIN = 1;
const SAMPLE_RATE_MAX = 60;

function commandSummary(command: CommandRow): string {
  if (command.type === 'toggle_gpio') {
    const payload = command.payload as { pin?: number; state?: number } | null;
    return `GPIO Pin ${payload?.pin ?? '?'} → ${payload?.state === 1 ? 'HIGH' : 'LOW'}`;
  }

  const payload = command.payload as { seconds?: number } | null;
  return `Poll Interval → ${payload?.seconds ?? '?'}s`;
}

export function CommandConsole({
  device,
  commands,
  now,
  onToggleGpio,
  onSetSampleRate,
}: CommandConsoleProps) {
  const [pin, setPin] = useState(0);
  const [state, setState] = useState<0 | 1>(1);
  const [seconds, setSeconds] = useState(device?.sampleRate ?? 5);
  const [busy, setBusy] = useState<'gpio' | 'rate' | null>(null);

  const disabled = device === null || busy !== null;

  const submitToggle = (): void => {
    if (device === null || busy !== null) {
      return;
    }

    setBusy('gpio');
    void onToggleGpio(pin, state).finally(() => {
      setBusy(null);
    });
  };

  const submitRate = (): void => {
    if (device === null || busy !== null) {
      return;
    }

    setBusy('rate');
    void onSetSampleRate(seconds).finally(() => {
      setBusy(null);
    });
  };

  return (
    <section className="panel control-panel" aria-labelledby="command-title">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Hardware Dispatch</span>
          <h2 id="command-title" className="panel-title">
            Command Operations
          </h2>
          <p className="panel-sub">
            {device === null
              ? 'Select a node from the fleet index to enable hardware control.'
              : `Dispatches to ${device.name}; executed on its next polling window.`}
          </p>
        </div>
      </div>

      {/* GPIO Control Form */}
      <form
        className="control-section"
        onSubmit={(event) => {
          event.preventDefault();
          submitToggle();
        }}
      >
        <div className="control-section__title">
          <h3>GPIO Output</h3>
          <span className="control-section__badge mono">Pin {pin}</span>
        </div>

        <div className="pin-grid" role="group" aria-label="Select GPIO pin">
          {PINS.map((value) => (
            <button
              key={value}
              type="button"
              className={`pin-button ${pin === value ? 'pin-button--active' : ''}`}
              aria-pressed={pin === value}
              aria-label={`Select Pin ${value}`}
              onClick={() => {
                setPin(value);
              }}
              disabled={disabled}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="level-segmented-wrap">
          <span className="control-label">Signal Level</span>
          <div className="level-toggle" role="radiogroup" aria-label="GPIO Signal Level">
            <button
              type="button"
              className={`level-toggle__btn ${state === 1 ? 'level-toggle__btn--active' : ''}`}
              onClick={() => setState(1)}
              disabled={disabled}
              role="radio"
              aria-checked={state === 1}
            >
              High (1)
            </button>
            <button
              type="button"
              className={`level-toggle__btn ${state === 0 ? 'level-toggle__btn--active' : ''}`}
              onClick={() => setState(0)}
              disabled={disabled}
              role="radio"
              aria-checked={state === 0}
            >
              Low (0)
            </button>
          </div>
        </div>

        <button type="submit" className="button button--primary button--block" disabled={disabled}>
          {busy === 'gpio' ? (
            'Queueing Dispatch…'
          ) : (
            <>
              <span>Queue Pin {pin}</span>
              <span className="button__meta">({state === 1 ? 'HIGH' : 'LOW'})</span>
            </>
          )}
        </button>
      </form>

      <div className="panel-rule" />

      {/* Sample Rate Form */}
      <form
        className="control-section"
        onSubmit={(event) => {
          event.preventDefault();
          submitRate();
        }}
      >
        <div className="control-section__title">
          <h3>Sample Interval</h3>
          <span className="control-output mono">{seconds}s</span>
        </div>

        <div className="slider-field">
          <input
            id="sample-rate"
            type="range"
            min={SAMPLE_RATE_MIN}
            max={SAMPLE_RATE_MAX}
            step={1}
            value={seconds}
            onChange={(event) => {
              setSeconds(Number(event.target.value));
            }}
            disabled={disabled}
            aria-label="Sample interval in seconds"
            aria-describedby="sample-rate-scale"
          />
          <div className="slider-scale" id="sample-rate-scale">
            <span>1s · High Frequency</span>
            <span>60s · Eco Mode</span>
          </div>
        </div>

        <button
          type="submit"
          className="button button--secondary button--block"
          disabled={disabled}
        >
          {busy === 'rate' ? 'Queueing Update…' : `Set ${seconds}s Interval`}
        </button>
      </form>

      <div className="panel-rule" />

      {/* Command Ledger */}
      <div className="ledger">
        <div className="control-section__title">
          <h3>Command Ledger</h3>
          <span className="panel-count mono">{commands.length}</span>
        </div>

        {commands.length === 0 ? (
          <p className="ledger__empty">No queued commands for this session.</p>
        ) : (
          <ul className="ledger__list">
            {commands.map((command) => (
              <li key={command.id} className="ledger__item">
                <span className="ledger__id mono">#{command.id}</span>
                <div className="ledger__body">
                  <span className="ledger__summary">{commandSummary(command)}</span>
                  <span className="ledger__time">
                    {formatRelativeTime(Date.parse(command.createdAt), now)}
                  </span>
                </div>
                <span className="command-status" data-status={command.status}>
                  {command.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
