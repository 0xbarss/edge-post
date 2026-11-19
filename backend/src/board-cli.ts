import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateBoards } from './board-generate.js';
import { BoardConfigError } from './board-profile.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface CliOptions {
  boardsDir: string;
  check: boolean;
  help: boolean;
}

function write(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function displayPath(filePath: string): string {
  const relative = path.relative(REPOSITORY_ROOT, filePath);
  return relative === '' || relative.startsWith('..') ? filePath : relative;
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    boardsDir: path.join(REPOSITORY_ROOT, 'firmware', 'boards'),
    check: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--check') {
      options.check = true;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--boards-dir') {
      const value = args[index + 1];

      if (value === undefined) {
        throw new Error('--boards-dir requires a path');
      }

      options.boardsDir = path.resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument ?? ''}`);
  }

  return options;
}

function printUsage(): void {
  write('Usage: npm run board:generate -- [--check] [--boards-dir <path>]');
  write('');
  write('Reads firmware/boards/<board>/<board>.ioc and writes board_config.h next to it,');
  write('plus firmware/boards/boards.json. --check reports files that are out of date.');
}

async function main(): Promise<void> {
  let options: CliOptions;

  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    writeError(error instanceof Error ? error.message : 'Invalid arguments');
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  try {
    const result = await generateBoards({
      rootDir: REPOSITORY_ROOT,
      boardsDir: options.boardsDir,
      check: options.check,
    });

    if (options.check) {
      if (result.outdated.length === 0) {
        if (result.boards.length === 0) {
          write(`No .ioc files found under ${options.boardsDir}`);
        } else {
          write(`Board configuration is up to date (${result.boards.length} board(s)).`);
        }

        return;
      }

      writeError('Board configuration is out of date:');

      for (const file of result.outdated) {
        writeError(`  ${displayPath(file)}`);
      }

      writeError('Run: make board');
      process.exitCode = 1;
      return;
    }

    if (result.boards.length === 0) {
      write(`No .ioc files found under ${options.boardsDir}`);

      for (const file of result.removed) {
        write(`Removed stale ${displayPath(file)}`);
      }

      return;
    }

    write(`Generated ${result.boards.length} board(s):`);

    for (const file of result.written) {
      write(`  ${displayPath(file)}`);
    }
  } catch (error) {
    if (error instanceof BoardConfigError) {
      writeError(error.message);
    } else {
      writeError(error instanceof Error ? error.message : 'Board generation failed');
    }

    process.exitCode = 1;
  }
}

void main();
