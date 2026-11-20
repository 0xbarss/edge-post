import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { BoardProfile } from './board-profile.js';
import { loadBoards } from './boards.js';
import type { Logger } from './logger.js';

const TEMP_DIRECTORIES: string[] = [];

const BOARD: BoardProfile = {
  name: 'alpha',
  source: 'boards/alpha/alpha.ioc',
  mcu: {
    name: 'STM32G071CBTx',
    cpn: 'STM32G071CBT6',
    family: 'STM32G0',
    package: 'LQFP48',
  },
  firmwarePackage: 'STM32Cube FW_G0 V1.6.3',
  clock: { sysclkHz: 64000000, hclkHz: 64000000, rtcSource: null },
  peripherals: ['ADC1', 'SPI1'],
  pins: [],
  groups: { adc: [], uart: [], spi: [], i2c: [], outputs: [], inputs: [] },
  roles: {
    temperature: null,
    networkSpi: null,
    networkUart: null,
    networkCsPin: null,
    outputs: [],
  },
};

function captureLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];

  return {
    messages,
    logger: {
      info: (_fields, message) => {
        messages.push(`info:${message}`);
      },
      warn: (_fields, message) => {
        messages.push(`warn:${message}`);
      },
      error: (_fields, message) => {
        messages.push(`error:${message}`);
      },
    },
  };
}

async function createManifest(content: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edge-post-catalog-'));
  TEMP_DIRECTORIES.push(directory);
  const filePath = path.join(directory, 'boards.json');
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('loadBoards', () => {
  it('reads a generated catalog', async () => {
    const filePath = await createManifest(JSON.stringify({ boards: [BOARD] }));
    const { logger, messages } = captureLogger();

    await expect(loadBoards(filePath, logger)).resolves.toEqual([BOARD]);
    expect(messages).toEqual([]);
  });

  it('returns an empty list when the catalog is absent', async () => {
    const { logger, messages } = captureLogger();

    await expect(loadBoards('/missing/boards.json', logger)).resolves.toEqual([]);
    expect(messages).toEqual(['info:board catalog not found; serving an empty list']);
  });

  it('returns an empty list when the catalog is not JSON', async () => {
    const filePath = await createManifest('{');
    const { logger, messages } = captureLogger();

    await expect(loadBoards(filePath, logger)).resolves.toEqual([]);
    expect(messages).toEqual(['warn:board catalog is not valid JSON']);
  });

  it('returns an empty list when the boards array is missing', async () => {
    const filePath = await createManifest('{}');
    const { logger, messages } = captureLogger();

    await expect(loadBoards(filePath, logger)).resolves.toEqual([]);
    expect(messages).toEqual(['warn:board catalog does not contain a boards array']);
  });

  it('skips entries without a board shape', async () => {
    const filePath = await createManifest(
      JSON.stringify({ boards: [BOARD, { name: 'broken' }, null] }),
    );
    const { logger, messages } = captureLogger();

    await expect(loadBoards(filePath, logger)).resolves.toEqual([BOARD]);
    expect(messages).toEqual(['warn:board catalog contains invalid entries']);
  });

  it('fills empty roles for catalogs generated before roles existed', async () => {
    const legacy: Record<string, unknown> = { ...BOARD };
    delete legacy.roles;
    const filePath = await createManifest(JSON.stringify({ boards: [legacy] }));
    const { logger, messages } = captureLogger();

    await expect(loadBoards(filePath, logger)).resolves.toEqual([BOARD]);
    expect(messages).toEqual([]);
  });

  it('skips entries with malformed nested fields', async () => {
    const badClock = { ...BOARD, name: 'bad-clock', clock: { sysclkHz: 64000000 } };
    const badGroups = {
      ...BOARD,
      name: 'bad-groups',
      groups: { ...BOARD.groups, adc: {} },
    };
    const badRoles = { ...BOARD, name: 'bad-roles', roles: { temperature: {} } };
    const filePath = await createManifest(
      JSON.stringify({ boards: [BOARD, badClock, badGroups, badRoles] }),
    );
    const { logger, messages } = captureLogger();

    await expect(loadBoards(filePath, logger)).resolves.toEqual([BOARD]);
    expect(messages).toEqual(['warn:board catalog contains invalid entries']);
  });
});
