import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, enqueueCommand, listDevices, listReadings, parseServerEvent } from './api';
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

function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message !== '') {
    return error.message;
  }

  return fallback;
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
      setDevices(next);
      setDevicesError(null);
    } catch (error) {
      setDevicesError(describeError(error, 'The device list could not be loaded'));
    }
  }, []);

  useEffect(() => {
    // The fetch resolves asynchronously; the lint rule cannot see past the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshDevices();
    const timer = window.setInterval(() => {
      void refreshDevices();
    }, DEVICE_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (selectedDeviceId === null) {
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
  }, [publishNotice, rangeMs, selectedDeviceId]);

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
    [publishNotice],
  );

  const points = seriesState.deviceId === selectedDeviceId ? seriesState.points : [];
  const recent = seriesState.deviceId === selectedDeviceId ? seriesState.recent : [];

  return {
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
  };
}
