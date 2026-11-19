export type DeviceStatus = 'online' | 'offline';
export type ConnectionState = 'connecting' | 'open' | 'closed';
export type CommandType = 'toggle_gpio' | 'set_sample_rate';
export type Theme = 'light' | 'dark';

export interface Device {
  deviceId: number;
  name: string;
  firstSeen: string;
  lastSeen: string;
  status: DeviceStatus;
  sampleRate: number;
}

export interface Reading {
  id: string;
  deviceId: number;
  sequence: number;
  ts: string;
  receivedAt: string;
  temperature: number;
  gpioState: number;
  sampleRate: number;
}

export interface ReadingPoint {
  ts: number;
  temperature: number;
}

export interface RecentReading {
  ts: number;
  temperature: number;
  gpioState: number;
}

export type NoticeTone = 'success' | 'error' | 'info';

export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
}

export interface DeviceView extends Device {
  latestTemperature: number | null;
  latestTs: number | null;
}

export interface CommandRow {
  id: number;
  deviceId: number;
  type: CommandType;
  payload: unknown;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  executedAt: string | null;
}

export interface ToggleGpioPayload {
  pin: number;
  state: 0 | 1;
}

export interface SetSampleRatePayload {
  seconds: number;
}

export interface ReadingEventData {
  deviceId: number;
  ts: string;
  temperature: number;
  gpioState: number;
}

export interface DeviceStatusEventData {
  deviceId: number;
  status: DeviceStatus;
}

export type ServerEvent =
  | { event: 'reading'; data: ReadingEventData }
  | { event: 'device:status'; data: DeviceStatusEventData }
  | { event: 'error'; data: { code: string; message: string } };
