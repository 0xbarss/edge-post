import type { Pool } from 'pg';

import { insertCommand, recordCommandStatus, takeNextPendingCommand } from './db.js';
import { ValidationError } from './errors.js';
import type { AckStatus, CommandFrame } from './frame.js';
import {
  COMMAND_TYPES,
  type CommandPayload,
  type CommandRow,
  type CommandStatus,
  type CommandType,
  type SetSampleRatePayload,
  type ToggleGpioPayload,
} from './models.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function readInteger(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const value = record[key];

  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ValidationError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }

  return value;
}

export function isCommandType(value: unknown): value is CommandType {
  return typeof value === 'string' && (COMMAND_TYPES as readonly string[]).includes(value);
}

export function parseCommandPayload(type: 'toggle_gpio', payload: unknown): ToggleGpioPayload;
export function parseCommandPayload(
  type: 'set_sample_rate',
  payload: unknown,
): SetSampleRatePayload;
export function parseCommandPayload(type: CommandType, payload: unknown): CommandPayload;
export function parseCommandPayload(type: CommandType, payload: unknown): CommandPayload {
  if (!isRecord(payload)) {
    throw new ValidationError('Command payload must be an object');
  }

  switch (type) {
    case 'toggle_gpio': {
      if (!hasExactKeys(payload, ['pin', 'state'])) {
        throw new ValidationError('toggle_gpio payload requires only pin and state');
      }

      const pin = readInteger(payload, 'pin', 0, 7, 'GPIO pin');
      const state = readInteger(payload, 'state', 0, 1, 'GPIO state');

      return { pin, state: state as 0 | 1 };
    }
    case 'set_sample_rate': {
      if (!hasExactKeys(payload, ['seconds'])) {
        throw new ValidationError('set_sample_rate payload requires only seconds');
      }

      return { seconds: readInteger(payload, 'seconds', 1, 255, 'Sample rate') };
    }
    default:
      throw new ValidationError(`Unknown command type ${String(type)}`);
  }
}

export function emptyCommandFrame(deviceId: number): CommandFrame {
  return { kind: 'command', deviceId, commandId: 0, type: 0, param1: 0, param2: 0 };
}

export function buildCommandFrame(
  deviceId: number,
  command: { id: number; type: CommandType; payload: unknown },
): CommandFrame {
  switch (command.type) {
    case 'toggle_gpio': {
      const payload = parseCommandPayload('toggle_gpio', command.payload);

      return {
        kind: 'command',
        deviceId,
        commandId: command.id,
        type: 1,
        param1: payload.pin,
        param2: payload.state,
      };
    }
    case 'set_sample_rate': {
      const payload = parseCommandPayload('set_sample_rate', command.payload);

      return {
        kind: 'command',
        deviceId,
        commandId: command.id,
        type: 2,
        param1: payload.seconds,
        param2: 0,
      };
    }
    default:
      throw new ValidationError(`Unknown command type ${String(command.type)}`);
  }
}

export function commandStatusForAcknowledgement(
  status: AckStatus,
): Extract<CommandStatus, 'executed' | 'failed'> {
  return status === 0 ? 'executed' : 'failed';
}

export async function enqueueCommand(
  pool: Pool,
  input: { deviceId: number; type: CommandType; payload: unknown },
): Promise<CommandRow> {
  const payload = parseCommandPayload(input.type, input.payload);
  return insertCommand(pool, {
    deviceId: input.deviceId,
    type: input.type,
    payload,
  });
}

export async function dequeueCommand(pool: Pool, deviceId: number): Promise<CommandFrame> {
  const command = await takeNextPendingCommand(pool, deviceId);

  if (command === null) {
    return emptyCommandFrame(deviceId);
  }

  return buildCommandFrame(deviceId, command);
}

export async function acknowledgeCommand(
  pool: Pool,
  deviceId: number,
  commandId: number,
  status: AckStatus,
): Promise<boolean> {
  return recordCommandStatus(pool, {
    commandId,
    deviceId,
    status: commandStatusForAcknowledgement(status),
  });
}
