import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateBoards } from './board-generate.js';

const TEMP_ROOTS: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'edge-post-boards-'));
  TEMP_ROOTS.push(root);
  return root;
}

function boardSource(name: string, label = 'STATUS_LED'): string {
  return [
    'Mcu.Name=STM32G071CBTx',
    'Mcu.Pin0=PC13',
    'PC13.Signal=GPIO_Output',
    `PC13.GPIO_Label=${label}`,
    `ProjectManager.ProjectName=${name}`,
    '',
  ].join('\n');
}

async function addBoard(
  root: string,
  directory: string,
  fileName: string,
  name: string,
): Promise<void> {
  const boardDirectory = path.join(root, 'boards', directory);
  await mkdir(boardDirectory, { recursive: true });
  await writeFile(path.join(boardDirectory, fileName), boardSource(name), 'utf8');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(TEMP_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('generateBoards', () => {
  it('writes a header and manifest, then reports a clean check', async () => {
    const root = await createRoot();
    await addBoard(root, 'alpha', 'alpha.ioc', 'alpha');
    const boardsDir = path.join(root, 'boards');

    const result = await generateBoards({ rootDir: root, boardsDir, check: false });
    const headerPath = path.join(boardsDir, 'alpha', 'board_config.h');
    const manifestPath = path.join(boardsDir, 'boards.json');
    const header = await readFile(headerPath, 'utf8');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      boards: Array<{ name: string; source: string }>;
    };

    expect(result.boards.map((board) => board.name)).toEqual(['alpha']);
    expect(result.written).toContain(headerPath);
    expect(header).toContain('#define BOARD_PROFILE_NAME "alpha"');
    expect(manifest).toMatchObject({
      boards: [{ name: 'alpha', source: 'boards/alpha/alpha.ioc' }],
    });

    const check = await generateBoards({ rootDir: root, boardsDir, check: true });

    expect(check.outdated).toEqual([]);
  });

  it('reports stale headers and manifest after the .ioc changes', async () => {
    const root = await createRoot();
    await addBoard(root, 'alpha', 'alpha.ioc', 'alpha');
    const boardsDir = path.join(root, 'boards');
    await generateBoards({ rootDir: root, boardsDir, check: false });

    const alphaIoc = path.join(boardsDir, 'alpha', 'alpha.ioc');
    const updated = boardSource('alpha', 'RUN_LED');
    await writeFile(alphaIoc, updated, 'utf8');

    const check = await generateBoards({ rootDir: root, boardsDir, check: true });

    expect(check.outdated).toEqual([
      path.join(boardsDir, 'alpha', 'board_config.h'),
      path.join(boardsDir, 'boards.json'),
    ]);
  });

  it('fails when two boards share a project name', async () => {
    const root = await createRoot();
    await addBoard(root, 'alpha', 'alpha.ioc', 'shared');
    await addBoard(root, 'beta', 'beta.ioc', 'shared');
    const boardsDir = path.join(root, 'boards');

    await expect(generateBoards({ rootDir: root, boardsDir, check: false })).rejects.toThrow(
      'Board name "shared" is already used by boards/alpha/alpha.ioc',
    );
  });

  it('fails when a board directory contains more than one .ioc file', async () => {
    const root = await createRoot();
    await addBoard(root, 'alpha', 'alpha.ioc', 'alpha');
    await addBoard(root, 'alpha', 'second.ioc', 'second');
    const boardsDir = path.join(root, 'boards');

    await expect(generateBoards({ rootDir: root, boardsDir, check: false })).rejects.toThrow(
      'Each board directory must contain exactly one .ioc file',
    );
  });

  it('does nothing when the boards directory is absent', async () => {
    const root = await createRoot();
    const boardsDir = path.join(root, 'boards');

    const result = await generateBoards({ rootDir: root, boardsDir, check: false });

    expect(result).toEqual({ boards: [], written: [], removed: [], outdated: [] });
    expect(await exists(path.join(boardsDir, 'boards.json'))).toBe(false);
  });

  it('removes a stale manifest when the last board is deleted', async () => {
    const root = await createRoot();
    await addBoard(root, 'alpha', 'alpha.ioc', 'alpha');
    const boardsDir = path.join(root, 'boards');
    const manifestPath = path.join(boardsDir, 'boards.json');
    await generateBoards({ rootDir: root, boardsDir, check: false });

    const boardDirectory = path.join(boardsDir, 'alpha');
    await rm(boardDirectory, { recursive: true, force: true });

    const result = await generateBoards({ rootDir: root, boardsDir, check: false });

    expect(result.removed).toEqual([manifestPath]);
    expect(await exists(manifestPath)).toBe(false);
    expect(await generateBoards({ rootDir: root, boardsDir, check: true })).toEqual({
      boards: [],
      written: [],
      removed: [],
      outdated: [],
    });
  });

  it('reports a stale manifest in check mode after the last board is deleted', async () => {
    const root = await createRoot();
    await addBoard(root, 'alpha', 'alpha.ioc', 'alpha');
    const boardsDir = path.join(root, 'boards');
    const manifestPath = path.join(boardsDir, 'boards.json');
    await generateBoards({ rootDir: root, boardsDir, check: false });
    await rm(path.join(boardsDir, 'alpha'), { recursive: true, force: true });

    const check = await generateBoards({ rootDir: root, boardsDir, check: true });

    expect(check.outdated).toEqual([manifestPath]);
  });
});
