export type DeviceStatus = 'online' | 'offline';
export type CommandStatus = 'pending' | 'delivered' | 'executed' | 'failed';

export const COMMAND_TYPES = ['toggle_gpio', 'set_sample_rate'] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface ToggleGpioPayload {
  pin: number;
  state: 0 | 1;
}

export interface SetSampleRatePayload {
  seconds: number;
}

export type CommandPayload = ToggleGpioPayload | SetSampleRatePayload;

export interface Device {
  deviceId: number;
  name: string;
  firstSeen: Date;
  lastSeen: Date;
  status: DeviceStatus;
  sampleRate: number;
}

export interface Reading {
  id: string;
  deviceId: number;
  sequence: number;
  ts: Date;
  receivedAt: Date;
  temperature: number;
  gpioState: number;
  sampleRate: number;
}

export interface ReadingInput {
  deviceId: number;
  sequence: number;
  timestamp: number;
  temperatureTenths: number;
  gpioState: number;
  sampleRate: number;
}

export interface CommandRow {
  id: number;
  deviceId: number;
  type: CommandType;
  payload: unknown;
  status: CommandStatus;
  createdAt: Date;
  deliveredAt: Date | null;
  executedAt: Date | null;
}

export interface PendingCommand {
  id: number;
  type: CommandType;
  payload: unknown;
}
