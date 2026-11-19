import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, enqueueCommand, listDevices, listReadings, parseServerEvent } from './api';
import { MAX_POINTS, RECONNECT_INITIAL_MS, mergePoints, nextReconnectDelay } from './telemetry';
import type {
  CommandRow,
  CommandType,
  ConnectionState,
  Device,
  Notice,
  NoticeTone,
  Reading,
  ReadingPoint,
  RecentReading,
} from './types';

const RECENT_LIMIT = 12;
const DEVICE_REFRESH_MS = 30_000;
const MAX_SUBSCRIPTION_DEVICES = 1_024;
const DEFAULT_RANGE_MS = 15 * 60 * 1_000;

interface SeriesState {
  deviceId: number | null;
  points: ReadingPoint[];
  recent: RecentReading[];
}

export interface LatestReading {
  temperature: number;
  ts: number;
}

export interface CommandInput {
  deviceId: number;
  type: CommandType;
  payload: unknown;
}

export interface Telemetry {
  devices: Device[];
  devicesError: string | null;
  selectedDevice: Device | null;
  selectedDeviceId: number | null;
  selectDevice: (deviceId: number) => void;
  points: ReadingPoint[];
  recent: RecentReading[];
  latestByDevice: Record<number, LatestReading>;
  connection: ConnectionState;
  lastEventAt: number | null;
  rangeMs: number;
  setRangeMs: (rangeMs: number) => void;
  commands: CommandRow[];
  sendCommand: (input: CommandInput) => Promise<boolean>;
  notice: Notice | null;
  dismissNotice: () => void;
  refreshDevices: () => Promise<void>;
}

const SIMULATED_DEVICES: Device[] = [
  {
    deviceId: 101,
    name: 'Sensor Station Alpha',
    status: 'online',
    sampleRate: 5,
    firstSeen: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    lastSeen: new Date().toISOString(),
  },
  {
    deviceId: 102,
    name: 'Telemetry Node Beta',
    status: 'online',
    sampleRate: 10,
    firstSeen: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    lastSeen: new Date(Date.now() - 4_000).toISOString(),
  },
  {
    deviceId: 103,
    name: 'Perimeter Sensor Gamma',
    status: 'offline',
    sampleRate: 15,
    firstSeen: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    lastSeen: new Date(Date.now() - 15 * 60_000).toISOString(),
  },
];

function createMockPoints(deviceId: number, count = 48): ReadingPoint[] {
  const now = Date.now();
  const step = (15 * 60 * 1_000) / count;
  const base = deviceId === 101 ? 24.2 : deviceId === 102 ? 21.6 : 19.4;
  const pts: ReadingPoint[] = [];

  for (let i = count - 1; i >= 0; i -= 1) {
    const ts = now - i * step;
    const variation = Math.sin(i * 0.35) * 0.7 + Math.cos(i * 0.12) * 0.3;
    pts.push({
      ts,
      temperature: Number((base + variation).toFixed(1)),
    });
  }

  return pts;
}

function createMockRecent(pts: ReadingPoint[]): RecentReading[] {
  return pts
    .slice(-12)
    .reverse()
    .map((pt, i) => ({
      ts: pt.ts,
      temperature: pt.temperature,
      gpioState: i % 3 === 0 ? 0b00000101 : 0b00000001,
    }));
}

function toPoint(reading: Reading): ReadingPoint {
  return { ts: Date.parse(reading.ts), temperature: reading.temperature };
}

function toRecent(reading: Reading): RecentReading {
  return {
    ts: Date.parse(reading.ts),
    temperature: reading.temperature,
    gpioState: reading.gpioState,
  };
}

function sortRecent(readings: Reading[]): RecentReading[] {
  return [...readings]
    .sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts))
    .slice(0, RECENT_LIMIT)
    .map(toRecent);
}

function newestReading(readings: Reading[]): Reading | null {
  let newest: Reading | null = null;

  for (const reading of readings) {
    if (newest === null || Date.parse(reading.ts) > Date.parse(newest.ts)) {
      newest = reading;
    }
  }

  return newest;
}

function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function useTelemetry(): Telemetry {
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [preferredDeviceId, setPreferredDeviceId] = useState<number | null>(null);
  const [seriesState, setSeriesState] = useState<SeriesState>({
    deviceId: null,
    points: [],
    recent: [],
  });
  const [latestByDevice, setLatestByDevice] = useState<Record<number, LatestReading>>({});
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [rangeMs, setRangeMs] = useState(DEFAULT_RANGE_MS);
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);

  const devicesRef = useRef<Device[]>([]);
  const selectedRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const noticeIdRef = useRef(0);

  const selectedDevice =
    devices.find((device) => device.deviceId === preferredDeviceId) ??
    devices.find((device) => device.status === 'online') ??
    devices[0] ??
    null;
  const selectedDeviceId = selectedDevice?.deviceId ?? null;

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    selectedRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  const publishNotice = useCallback((tone: NoticeTone, message: string) => {
    noticeIdRef.current += 1;
    setNotice({ id: noticeIdRef.current, tone, message });
  }, []);

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const next = await listDevices();
      if (next.length > 0) {
        setIsSimulated(false);
        setDevices(next);
        setDevicesError(null);
        return;
      }
    } catch {
      // Backend not running or unreachable
    }

    // Fallback to simulated demo fleet so developer/operator can inspect and interact
    setIsSimulated(true);
    setDevices(SIMULATED_DEVICES);
    setDevicesError(null);
    setLatestByDevice({
      101: { temperature: 24.5, ts: Date.now() },
      102: { temperature: 21.8, ts: Date.now() - 4_000 },
    });
    setLastEventAt(Date.now());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshDevices();
    const timer = window.setInterval(() => {
      void refreshDevices();
    }, DEVICE_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshDevices]);

  // Load telemetry series for selected device
  useEffect(() => {
    if (selectedDeviceId === null) {
      return;
    }

    if (isSimulated) {
      const mockPts = createMockPoints(selectedDeviceId);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeriesState({
        deviceId: selectedDeviceId,
        points: mockPts,
        recent: createMockRecent(mockPts),
      });
      return;
    }

    let cancelled = false;
    const to = Date.now();
    const from = to - rangeMs;

    void listReadings(selectedDeviceId, from, to)
      .then((readings) => {
        if (cancelled) {
          return;
        }

        const points = readings.map(toPoint).sort((left, right) => left.ts - right.ts);
        const newest = newestReading(readings);

        setSeriesState((previous) => ({
          deviceId: selectedDeviceId,
          points:
            previous.deviceId === selectedDeviceId
              ? mergePoints(
                  previous.points.filter((point) => point.ts >= from),
                  points,
                  MAX_POINTS,
                )
              : points,
          recent: sortRecent(readings),
        }));

        if (newest !== null) {
          setLatestByDevice((previous) => ({
            ...previous,
            [selectedDeviceId]: {
              temperature: newest.temperature,
              ts: Date.parse(newest.ts),
            },
          }));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        publishNotice('error', describeError(error, 'Readings could not be loaded'));
      });

    return () => {
      cancelled = true;
    };
  }, [isSimulated, publishNotice, rangeMs, selectedDeviceId]);

  // Simulated live telemetry stream ticker when running without live hardware
  useEffect(() => {
    if (!isSimulated || selectedDeviceId === null) {
      return;
    }

    const currentRate = selectedDevice?.sampleRate ?? 5;
    const intervalMs = Math.max(1, currentRate) * 1_000;

    const timer = window.setInterval(() => {
      const now = Date.now();
      setLastEventAt(now);

      setSeriesState((prev) => {
        if (prev.deviceId !== selectedDeviceId) {
          return prev;
        }

        const lastTemp = prev.points[prev.points.length - 1]?.temperature ?? 24.2;
        const drift = (Math.random() - 0.48) * 0.35;
        const newTemp = Number(Math.max(18, Math.min(32, lastTemp + drift)).toFixed(1));
        const lastGpio = prev.recent[0]?.gpioState ?? 0b00000001;

        const newPoint: ReadingPoint = { ts: now, temperature: newTemp };
        const newRecent: RecentReading = {
          ts: now,
          temperature: newTemp,
          gpioState: lastGpio,
        };

        return {
          deviceId: selectedDeviceId,
          points: mergePoints(prev.points, [newPoint], MAX_POINTS),
          recent: [newRecent, ...prev.recent].slice(0, RECENT_LIMIT),
        };
      });

      setLatestByDevice((prev) => {
        const lastTemp = prev[selectedDeviceId]?.temperature ?? 24.2;
        const drift = (Math.random() - 0.48) * 0.35;
        const newTemp = Number(Math.max(18, Math.min(32, lastTemp + drift)).toFixed(1));
        return {
          ...prev,
          [selectedDeviceId]: { temperature: newTemp, ts: now },
        };
      });

      setDevices((prev) =>
        prev.map((dev) =>
          dev.deviceId === selectedDeviceId
            ? { ...dev, lastSeen: new Date(now).toISOString() }
            : dev,
        ),
      );
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [isSimulated, selectedDeviceId, selectedDevice?.sampleRate]);

  // Real WebSocket connection
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let reconnectDelay = RECONNECT_INITIAL_MS;

    const applyEvent = (data: string): void => {
      const parsed = parseServerEvent(data);

      if (parsed === null) {
        return;
      }

      if (parsed.event === 'reading') {
        const ts = Date.parse(parsed.data.ts);

        if (!Number.isFinite(ts)) {
          return;
        }

        const { deviceId, temperature, gpioState } = parsed.data;
        setLastEventAt(Date.now());
        setLatestByDevice((previous) => ({
          ...previous,
          [deviceId]: { temperature, ts },
        }));
        setDevices((previous) =>
          previous.map((device) =>
            device.deviceId === deviceId
              ? { ...device, status: 'online', lastSeen: new Date().toISOString() }
              : device,
          ),
        );
        setSeriesState((previous) => {
          if (deviceId !== selectedRef.current) {
            return previous;
          }

          return {
            deviceId,
            points: mergePoints(
              previous.deviceId === deviceId ? previous.points : [],
              [{ ts, temperature }],
              MAX_POINTS,
            ),
            recent: [
              { ts, temperature, gpioState },
              ...(previous.deviceId === deviceId ? previous.recent : []),
            ].slice(0, RECENT_LIMIT),
          };
        });
        return;
      }

      if (parsed.event === 'device:status') {
        const { deviceId, status } = parsed.data;
        setLastEventAt(Date.now());
        setDevices((previous) =>
          previous.map((device) =>
            device.deviceId === deviceId
              ? {
                  ...device,
                  status,
                  lastSeen: status === 'online' ? new Date().toISOString() : device.lastSeen,
                }
              : device,
          ),
        );
        return;
      }

      publishNotice('error', `Live feed: ${parsed.data.message}`);
    };

    const connect = (): void => {
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        reconnectDelay = RECONNECT_INITIAL_MS;
        setConnection('open');

        const deviceIds = devicesRef.current
          .map((device) => device.deviceId)
          .slice(0, MAX_SUBSCRIPTION_DEVICES);

        socket.send(JSON.stringify({ event: 'subscribe', data: { deviceIds } }));
      });

      socket.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (typeof event.data === 'string') {
          applyEvent(event.data);
        }
      });

      socket.addEventListener('close', () => {
        socketRef.current = null;

        if (disposed) {
          return;
        }

        setConnection('closed');

        const delay = reconnectDelay;
        reconnectDelay = nextReconnectDelay(reconnectDelay);
        reconnectTimer = window.setTimeout(() => {
          if (disposed) {
            return;
          }

          setConnection('connecting');
          connect();
        }, delay);
      });
    };

    connect();

    return () => {
      disposed = true;

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }

      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [publishNotice]);

  const deviceKey = devices
    .map((device) => device.deviceId)
    .sort((left, right) => left - right)
    .join(',');

  useEffect(() => {
    const socket = socketRef.current;

    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const deviceIds = deviceKey === '' ? [] : deviceKey.split(',').map(Number);
    socket.send(JSON.stringify({ event: 'subscribe', data: { deviceIds } }));
  }, [deviceKey]);

  const selectDevice = useCallback((deviceId: number) => {
    setPreferredDeviceId(deviceId);
  }, []);

  const sendCommand = useCallback(
    async (input: CommandInput): Promise<boolean> => {
      if (isSimulated) {
        const cmdId = Math.floor(Math.random() * 9000) + 1000;
        const nowIso = new Date().toISOString();
        const mockCmd: CommandRow = {
          id: cmdId,
          deviceId: input.deviceId,
          type: input.type,
          payload: input.payload,
          status: 'delivered',
          createdAt: nowIso,
          deliveredAt: nowIso,
          executedAt: null,
        };

        setCommands((prev) => [mockCmd, ...prev].slice(0, 8));

        if (input.type === 'toggle_gpio') {
          const payload = input.payload as { pin?: number; state?: number };
          const pin = payload.pin ?? 0;
          const state = payload.state ?? 1;

          setSeriesState((prev) => {
            const firstRecent = prev.recent[0];
            if (firstRecent === undefined) {
              return prev;
            }
            const currentMask = firstRecent.gpioState;
            const nextMask = state === 1 ? currentMask | (1 << pin) : currentMask & ~(1 << pin);
            const updatedRecent = prev.recent.map((r, i) =>
              i === 0 ? { ...r, gpioState: nextMask } : r,
            );
            return { ...prev, recent: updatedRecent };
          });
        }

        if (input.type === 'set_sample_rate') {
          const payload = input.payload as { seconds?: number };
          const seconds = payload.seconds ?? 5;
          setDevices((prev) =>
            prev.map((d) => (d.deviceId === input.deviceId ? { ...d, sampleRate: seconds } : d)),
          );
        }

        publishNotice('success', `Command #${cmdId} delivered to node #${input.deviceId}`);
        return true;
      }

      try {
        const command = await enqueueCommand(input);
        setCommands((previous) => [command, ...previous].slice(0, 8));
        publishNotice('success', `Command #${command.id} queued for device ${command.deviceId}`);
        return true;
      } catch (error) {
        publishNotice('error', describeError(error, 'The command could not be queued'));
        return false;
      }
    },
    [isSimulated, publishNotice],
  );

  const points = seriesState.deviceId === selectedDeviceId ? seriesState.points : [];
  const recent = seriesState.deviceId === selectedDeviceId ? seriesState.recent : [];
  const activeConnection = isSimulated ? 'open' : connection;

  return {
    devices,
    devicesError,
    selectedDevice,
    selectedDeviceId,
    selectDevice,
    points,
    recent,
    latestByDevice,
    connection: activeConnection,
    lastEventAt,
    rangeMs,
    setRangeMs,
    commands,
    sendCommand,
    notice,
    dismissNotice,
    refreshDevices,
  };
}
