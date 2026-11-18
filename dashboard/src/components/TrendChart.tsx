import { useId, useState } from 'react';

import { formatClock, formatDateTime, formatTemperature } from '../format';
import type { Device, ReadingPoint } from '../types';

const RANGE_OPTIONS = [
  { label: '5m', value: 5 * 60 * 1_000 },
  { label: '15m', value: 15 * 60 * 1_000 },
  { label: '30m', value: 30 * 60 * 1_000 },
] as const;

const WIDTH = 900;
const HEIGHT = 360;
const PLOT = { left: 56, right: 882, top: 24, bottom: 310 } as const;
const X_TICKS = 5;

interface TrendChartProps {
  device: Device | null;
  points: ReadingPoint[];
  now: number;
  rangeMs: number;
  onRangeChange: (rangeMs: number) => void;
}

interface Domain {
  minimum: number;
  maximum: number;
  ticks: number[];
}

function temperatureDomain(points: ReadingPoint[]): Domain {
  const temperatures = points.map((point) => point.temperature);
  const minimum = Math.min(...temperatures);
  const maximum = Math.max(...temperatures);
  const span = maximum - minimum < 0.2 ? 1 : maximum - minimum;
  const paddedMinimum = minimum - span * 0.12;
  const paddedMaximum = maximum + span * 0.12;

  return {
    minimum: paddedMinimum,
    maximum: paddedMaximum,
    ticks: niceTicks(paddedMinimum, paddedMaximum),
  };
}

function niceTicks(minimum: number, maximum: number): number[] {
  const rawStep = (maximum - minimum) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];

  for (let value = Math.ceil(minimum / step) * step; value <= maximum; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }

  return ticks;
}

function rangeLabel(rangeMs: number): string {
  return `${Math.round(rangeMs / 60_000)} min`;
}

export function TrendChart({ device, points, now, rangeMs, onRangeChange }: TrendChartProps) {
  const fillId = `trace${useId().replaceAll(':', '')}`;
  const [hovered, setHovered] = useState<ReadingPoint | null>(null);

  const from = now - rangeMs;
  const visible = points.filter((point) => point.ts >= from && point.ts <= now + 60_000);
  const active = hovered !== null && visible.includes(hovered) ? hovered : null;

  const domain = visible.length === 0 ? null : temperatureDomain(visible);
  const mean =
    visible.length === 0
      ? null
      : visible.reduce((total, point) => total + point.temperature, 0) / visible.length;
  const minimum =
    visible.length === 0 ? null : Math.min(...visible.map((point) => point.temperature));
  const maximum =
    visible.length === 0 ? null : Math.max(...visible.map((point) => point.temperature));

  const xFor = (ts: number): number =>
    PLOT.left + ((ts - from) / rangeMs) * (PLOT.right - PLOT.left);
  const yFor = (temperature: number): number =>
    domain === null
      ? PLOT.bottom
      : PLOT.bottom -
        ((temperature - domain.minimum) / (domain.maximum - domain.minimum)) *
          (PLOT.bottom - PLOT.top);

  const line =
    visible.length === 0
      ? ''
      : visible
          .map(
            (point, index) =>
              `${index === 0 ? 'M' : 'L'}${xFor(point.ts).toFixed(1)},${yFor(point.temperature).toFixed(1)}`,
          )
          .join(' ');
  const area =
    line === ''
      ? ''
      : `${line} L${xFor(visible[visible.length - 1]?.ts ?? now).toFixed(1)},${PLOT.bottom} L${PLOT.left},${PLOT.bottom} Z`;

  const xTicks = Array.from(
    { length: X_TICKS },
    (_, index) => from + (rangeMs * index) / (X_TICKS - 1),
  );

  const describe = (): string => {
    if (visible.length === 0) {
      return `No temperature samples for ${device?.name ?? 'the selected device'} in the last ${rangeLabel(rangeMs)}.`;
    }

    return `Temperature trace for ${device?.name ?? 'the selected device'} over the last ${rangeLabel(rangeMs)}. ${visible.length} samples between ${minimum?.toFixed(1)} and ${maximum?.toFixed(1)} degrees Celsius.`;
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (visible.length === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    const pointerTs = from + ((pointerX - PLOT.left) / (PLOT.right - PLOT.left)) * rangeMs;

    let nearest = visible[0];

    if (nearest === undefined) {
      return;
    }

    for (const point of visible) {
      if (Math.abs(point.ts - pointerTs) < Math.abs(nearest.ts - pointerTs)) {
        nearest = point;
      }
    }

    setHovered(nearest);
  };

  const tooltipX = active === null ? 0 : xFor(active.ts);
  const tooltipY = active === null ? 0 : yFor(active.temperature);
  const tooltipLeft = Math.min(Math.max(tooltipX - 64, PLOT.left), PLOT.right - 138);
  const tooltipTop = Math.max(tooltipY - 74, PLOT.top);

  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="panel-heading chart-heading">
        <div>
          <p className="panel-kicker">Signal / temperature</p>
          <h2 id="chart-title">Temperature trace</h2>
          <div className="chart-figures">
            <span>
              <small>min</small>
              {formatTemperature(minimum)}
            </span>
            <span>
              <small>mean</small>
              {formatTemperature(mean)}
            </span>
            <span>
              <small>max</small>
              {formatTemperature(maximum)}
            </span>
            <span>
              <small>window</small>
              {rangeLabel(rangeMs)}
            </span>
          </div>
        </div>

        <div className="range-tabs" role="group" aria-label="Chart time range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className="range-tabs__button"
              aria-pressed={rangeMs === option.value}
              onClick={() => {
                onRangeChange(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 || domain === null ? (
        <div className="chart-empty">
          <span className="chart-empty__mark" aria-hidden="true">
            —
          </span>
          <p className="chart-empty__title">No frames in this window</p>
          <p className="chart-empty__body">
            {device === null
              ? 'Select a device to see its temperature trace.'
              : `Waiting for ${device.name} to report. The trace fills as readings arrive.`}
          </p>
        </div>
      ) : (
        <>
          <svg
            className="trend-chart"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={describe()}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => {
              setHovered(null);
            }}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.14" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {domain.ticks.map((tick) => {
              const y = yFor(tick);

              return (
                <g key={tick}>
                  <line x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} className="chart-grid" />
                  <text x={PLOT.left - 14} y={y + 4} textAnchor="end" className="chart-axis">
                    {tick.toFixed(1)}°
                  </text>
                </g>
              );
            })}

            {xTicks.map((tick, index) => (
              <text
                key={tick}
                x={xFor(tick)}
                y={HEIGHT - 12}
                textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
                className="chart-axis"
              >
                {formatClock(tick)}
              </text>
            ))}

            <line
              x1={PLOT.left}
              x2={PLOT.right}
              y1={PLOT.bottom}
              y2={PLOT.bottom}
              className="chart-axis-line"
            />

            {mean !== null && (
              <line
                x1={PLOT.left}
                x2={PLOT.right}
                y1={yFor(mean)}
                y2={yFor(mean)}
                className="chart-mean"
              />
            )}

            <path d={area} fill={`url(#${fillId})`} />
            <path d={line} className="chart-line" />

            {active !== null && (
              <g pointerEvents="none">
                <line
                  x1={tooltipX}
                  x2={tooltipX}
                  y1={PLOT.top}
                  y2={PLOT.bottom}
                  className="chart-crosshair"
                />
                <circle cx={tooltipX} cy={tooltipY} r={5} className="chart-point" />
                <rect
                  x={tooltipLeft}
                  y={tooltipTop}
                  width={138}
                  height={52}
                  rx={4}
                  className="chart-tooltip"
                />
                <text x={tooltipLeft + 12} y={tooltipTop + 21} className="chart-tooltip__time">
                  {formatDateTime(active.ts)}
                </text>
                <text x={tooltipLeft + 12} y={tooltipTop + 41} className="chart-tooltip__value">
                  {formatTemperature(active.temperature)}
                </text>
              </g>
            )}
          </svg>

          <div className="chart-legend">
            <span>
              <i className="legend-swatch legend-swatch--line" aria-hidden="true" />
              Reading
            </span>
            <span>
              <i className="legend-swatch legend-swatch--mean" aria-hidden="true" />
              Window mean {mean === null ? '' : `(${mean.toFixed(1)}°)`}
            </span>
            <span className="chart-legend__hint">{visible.length} samples · local time</span>
          </div>
        </>
      )}
    </section>
  );
}
