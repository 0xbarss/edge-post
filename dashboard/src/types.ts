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

export interface BoardMcu {
  name: string;
  cpn: string | null;
  family: string | null;
  package: string | null;
}

export interface BoardClock {
  sysclkHz: number | null;
  hclkHz: number | null;
  rtcSource: string | null;
}

export interface BoardPin {
  pin: string;
  signal: string;
  label: string | null;
  initialState: 'set' | 'reset' | null;
}

export interface BoardAdcChannel {
  instance: string;
  channel: number;
  pin: string;
  label: string | null;
}

export interface BoardUart {
  instance: string;
  txPin: string | null;
  rxPin: string | null;
}

export interface BoardSpi {
  instance: string;
  sckPin: string | null;
  misoPin: string | null;
  mosiPin: string | null;
  nssPin: string | null;
}

export interface BoardI2c {
  instance: string;
  sclPin: string | null;
  sdaPin: string | null;
}

export interface BoardGpio {
  pin: string;
  label: string | null;
}

export interface BoardGroups {
  adc: BoardAdcChannel[];
  uart: BoardUart[];
  spi: BoardSpi[];
  i2c: BoardI2c[];
  outputs: BoardGpio[];
  inputs: BoardGpio[];
}

export interface BoardProfile {
  name: string;
  source: string;
  mcu: BoardMcu;
  firmwarePackage: string | null;
  clock: BoardClock;
  peripherals: string[];
  pins: BoardPin[];
  groups: BoardGroups;
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
