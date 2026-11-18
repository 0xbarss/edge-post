export function formatTemperature(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}°`;
}

export function formatTemperatureDelta(delta: number | null): string {
  if (delta === null) {
    return 'No baseline yet';
  }

  if (Math.abs(delta) < 0.05) {
    return 'Flat vs 5 min ago';
  }

  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta).toFixed(1)}° vs 5 min ago`;
}

export function formatRelativeTime(timestamp: number | null, now: number): string {
  if (timestamp === null) {
    return '—';
  }

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));

  if (seconds < 5) {
    return 'just now';
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function formatClock(timestamp: number): string {
  return clockFormatter.format(timestamp);
}

export function formatDateTime(timestamp: number): string {
  return dateTimeFormatter.format(timestamp);
}

export function formatDate(timestamp: number): string {
  return dateFormatter.format(timestamp);
}

export function formatGpio(state: number): string {
  return state.toString(2).padStart(8, '0');
}

export function formatRate(value: number): string {
  return `${value.toFixed(0)}/min`;
}
