import type { ReadingPoint } from '../types';

interface SparklineProps {
  points: ReadingPoint[];
  className?: string;
}

export function Sparkline({ points, className = '' }: SparklineProps) {
  if (points.length < 2) {
    return <div className={`sparkline sparkline--empty ${className}`.trim()} aria-hidden="true" />;
  }

  const width = 148;
  const height = 42;
  const padding = 3;
  const temperatures = points.map((point) => point.temperature);
  const minimum = Math.min(...temperatures);
  const maximum = Math.max(...temperatures);
  const span = maximum - minimum === 0 ? 1 : maximum - minimum;

  const coordinates = points.map((point) => {
    const x =
      padding +
      ((point.ts - (points[0]?.ts ?? point.ts)) / timelineSpan(points)) * (width - padding * 2);
    const y = height - padding - ((point.temperature - minimum) / span) * (height - padding * 2);

    return { x: Number.isFinite(x) ? x : padding, y };
  });

  const line = coordinates
    .map(
      (coordinate, index) =>
        `${index === 0 ? 'M' : 'L'}${coordinate.x.toFixed(1)},${coordinate.y.toFixed(1)}`,
    )
    .join(' ');
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const area =
    first && last
      ? `${line} L ${last.x.toFixed(1)},${height} L ${first.x.toFixed(1)},${height} Z`
      : '';

  return (
    <svg
      className={`sparkline ${className}`.trim()}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill="url(#sparklineGrad)" />}
      <path d={line} className="sparkline-line" />
      {last !== undefined && <circle cx={last.x} cy={last.y} r={2.5} className="sparkline-point" />}
    </svg>
  );
}

function timelineSpan(points: ReadingPoint[]): number {
  const first = points[0]?.ts ?? 0;
  const last = points[points.length - 1]?.ts ?? first;
  return last - first === 0 ? 1 : last - first;
}
