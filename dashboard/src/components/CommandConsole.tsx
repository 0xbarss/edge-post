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
    return `GPIO ${payload?.pin ?? '?'} → ${payload?.state === 1 ? 'high' : 'low'}`;
  }

  const payload = command.payload as { seconds?: number } | null;
  return `Interval → ${payload?.seconds ?? '?'} s`;
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
          <p className="panel-kicker">
            <span className="section-index mono">04</span>
            Operations
          </p>
          <h2 id="command-title">Command console</h2>
          <p className="panel-sub">
            {device === null
              ? 'Select a node to enable commands.'
              : `Queued for ${device.name}; delivered on its next poll.`}
          </p>
        </div>
      </div>

      <form
        className="control-section"
        onSubmit={(event) => {
          event.preventDefault();
          submitToggle();
        }}
      >
        <div className="control-section__title">
          <h3>GPIO output</h3>
          <span className="mono">pin {pin}</span>
        </div>

        <div className="pin-grid" role="group" aria-label="GPIO pin">
          {PINS.map((value) => (
            <button
              key={value}
              type="button"
              className="pin-button"
              aria-pressed={pin === value}
              aria-label={`Pin ${value}`}
              onClick={() => {
                setPin(value);
              }}
              disabled={disabled}
            >
              {value}
            </button>
          ))}
        </div>

        <fieldset className="level-field" disabled={disabled}>
          <legend>Level</legend>
          <div className="level-toggle">
            <label>
              <input
                type="radio"
                name="gpio-state"
                value="1"
                checked={state === 1}
                onChange={() => {
                  setState(1);
                }}
              />
              <span>High</span>
            </label>
            <label>
              <input
                type="radio"
                name="gpio-state"
                value="0"
                checked={state === 0}
                onChange={() => {
                  setState(0);
                }}
              />
              <span>Low</span>
            </label>
          </div>
        </fieldset>

        <button type="submit" className="button button--primary button--block" disabled={disabled}>
          {busy === 'gpio' ? 'Queuing…' : `Queue pin ${pin} ${state === 1 ? 'high' : 'low'}`}
        </button>
      </form>

      <div className="panel-rule" />

      <form
        className="control-section"
        onSubmit={(event) => {
          event.preventDefault();
          submitRate();
        }}
      >
        <div className="control-section__title">
          <h3>Sample interval</h3>
          <output className="control-output" htmlFor="sample-rate">
            {seconds} s
          </output>
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
            <span>1 s · faster</span>
            <span>60 s · quieter</span>
          </div>
        </div>

        <button
          type="submit"
          className="button button--secondary button--block"
          disabled={disabled}
        >
          {busy === 'rate' ? 'Queuing…' : `Queue ${seconds} s interval`}
        </button>
      </form>

      <div className="panel-rule" />

      <div className="ledger">
        <div className="control-section__title">
          <h3>Command ledger</h3>
          <span className="mono">{commands.length}</span>
        </div>
        {commands.length === 0 ? (
          <p className="ledger__empty">No commands queued from this console.</p>
        ) : (
          <ul>
            {commands.map((command) => (
              <li key={command.id}>
                <span className="ledger__id mono">#{command.id}</span>
                <span className="ledger__body">
                  {commandSummary(command)}
                  <small>{formatRelativeTime(Date.parse(command.createdAt), now)}</small>
                </span>
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
