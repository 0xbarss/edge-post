import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type {
  BoardAdcChannel,
  BoardGpio,
  BoardI2c,
  BoardPin,
  BoardProfile,
  BoardSpi,
  BoardUart,
} from './board-profile.js';
import type { Logger } from './logger.js';
import { isRecord } from './validation.js';

export const DEFAULT_BOARDS_FILE = fileURLToPath(
  new URL('../../firmware/boards/boards.json', import.meta.url),
);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

function isPin(value: unknown): value is BoardPin {
  return (
    isRecord(value) &&
    typeof value.pin === 'string' &&
    typeof value.signal === 'string' &&
    isNullableString(value.label) &&
    (value.initialState === null || value.initialState === 'set' || value.initialState === 'reset')
  );
}

function isAdcChannel(value: unknown): value is BoardAdcChannel {
  return (
    isRecord(value) &&
    typeof value.instance === 'string' &&
    typeof value.channel === 'number' &&
    typeof value.pin === 'string' &&
    isNullableString(value.label)
  );
}

function isUart(value: unknown): value is BoardUart {
  return (
    isRecord(value) &&
    typeof value.instance === 'string' &&
    isNullableString(value.txPin) &&
    isNullableString(value.rxPin)
  );
}

function isSpi(value: unknown): value is BoardSpi {
  return (
    isRecord(value) &&
    typeof value.instance === 'string' &&
    isNullableString(value.sckPin) &&
    isNullableString(value.misoPin) &&
    isNullableString(value.mosiPin) &&
    isNullableString(value.nssPin)
  );
}

function isI2c(value: unknown): value is BoardI2c {
  return (
    isRecord(value) &&
    typeof value.instance === 'string' &&
    isNullableString(value.sclPin) &&
    isNullableString(value.sdaPin)
  );
}

function isGpio(value: unknown): value is BoardGpio {
  return isRecord(value) && typeof value.pin === 'string' && isNullableString(value.label);
}

function isBoardProfile(value: unknown): value is BoardProfile {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.source === 'string' &&
    isRecord(value.mcu) &&
    typeof value.mcu.name === 'string' &&
    isNullableString(value.mcu.cpn) &&
    isNullableString(value.mcu.family) &&
    isNullableString(value.mcu.package) &&
    isNullableString(value.firmwarePackage) &&
    isRecord(value.clock) &&
    isNullableNumber(value.clock.sysclkHz) &&
    isNullableNumber(value.clock.hclkHz) &&
    isNullableString(value.clock.rtcSource) &&
    isArrayOf(value.peripherals, (item): item is string => typeof item === 'string') &&
    isArrayOf(value.pins, isPin) &&
    isRecord(value.groups) &&
    isArrayOf(value.groups.adc, isAdcChannel) &&
    isArrayOf(value.groups.uart, isUart) &&
    isArrayOf(value.groups.spi, isSpi) &&
    isArrayOf(value.groups.i2c, isI2c) &&
    isArrayOf(value.groups.outputs, isGpio) &&
    isArrayOf(value.groups.inputs, isGpio)
  );
}

export async function loadBoards(filePath: string, logger: Logger): Promise<BoardProfile[]> {
  let text: string;

  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.info({ filePath }, 'board catalog not found; serving an empty list');
      return [];
    }

    logger.warn({ err: error, filePath }, 'board catalog could not be read');
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    logger.warn({ filePath }, 'board catalog is not valid JSON');
    return [];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.boards)) {
    logger.warn({ filePath }, 'board catalog does not contain a boards array');
    return [];
  }

  const boards = parsed.boards.filter(isBoardProfile);

  if (boards.length !== parsed.boards.length) {
    logger.warn(
      { filePath, skipped: parsed.boards.length - boards.length },
      'board catalog contains invalid entries',
    );
  }

  return boards;
}
