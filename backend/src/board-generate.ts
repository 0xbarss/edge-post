import type { Dirent } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BoardConfigError,
  parseIoc,
  renderBoardHeader,
  renderBoardsManifest,
  type BoardProfile,
} from './board-profile.js';

export interface GenerateBoardsOptions {
  rootDir: string;
  boardsDir: string;
  check: boolean;
}

export interface GenerateBoardsResult {
  boards: BoardProfile[];
  written: string[];
  outdated: string[];
}

interface BoardSource {
  profile: BoardProfile;
  headerPath: string;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

async function findIocFiles(boardsDir: string): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = await readdir(boardsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const files: string[] = [];

  for (const directory of directories) {
    const directoryPath = path.join(boardsDir, directory);
    const boardFiles = (await readdir(directoryPath))
      .filter((file) => file.endsWith('.ioc'))
      .sort();

    if (boardFiles.length > 1) {
      throw new BoardConfigError(
        'Each board directory must contain exactly one .ioc file',
        directoryPath,
      );
    }

    for (const file of boardFiles) {
      files.push(path.join(directoryPath, file));
    }
  }

  return files;
}

async function readBoardSources(rootDir: string, boardsDir: string): Promise<BoardSource[]> {
  const sources: BoardSource[] = [];
  const seen = new Map<string, string>();

  for (const iocPath of await findIocFiles(boardsDir)) {
    const text = await readFile(iocPath, 'utf8');
    const source = toPosix(path.relative(rootDir, iocPath));
    const profile = parseIoc(text, source);
    const existing = seen.get(profile.name);

    if (existing !== undefined) {
      throw new BoardConfigError(
        `Board name "${profile.name}" is already used by ${existing}`,
        source,
      );
    }

    seen.set(profile.name, source);
    sources.push({
      profile,
      headerPath: path.join(path.dirname(iocPath), 'board_config.h'),
    });
  }

  sources.sort((left, right) =>
    left.profile.name < right.profile.name ? -1 : left.profile.name > right.profile.name ? 1 : 0,
  );

  return sources;
}

async function writeOrCompare(
  filePath: string,
  content: string,
  check: boolean,
  written: string[],
  outdated: string[],
): Promise<void> {
  if (check) {
    let current: string | null = null;

    try {
      current = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    if (current !== content) {
      outdated.push(filePath);
    }

    return;
  }

  await writeFile(filePath, content, 'utf8');
  written.push(filePath);
}

export async function generateBoards(
  options: GenerateBoardsOptions,
): Promise<GenerateBoardsResult> {
  const sources = await readBoardSources(options.rootDir, options.boardsDir);
  const written: string[] = [];
  const outdated: string[] = [];

  for (const source of sources) {
    await writeOrCompare(
      source.headerPath,
      renderBoardHeader(source.profile),
      options.check,
      written,
      outdated,
    );
  }

  if (sources.length > 0) {
    await writeOrCompare(
      path.join(options.boardsDir, 'boards.json'),
      renderBoardsManifest(sources.map((source) => source.profile)),
      options.check,
      written,
      outdated,
    );
  }

  return {
    boards: sources.map((source) => source.profile),
    written,
    outdated,
  };
}
