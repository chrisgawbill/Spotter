import { existsSync } from 'node:fs';
import path from 'node:path';

/** Parses `prettier --check` output: one finding per unformatted file. */
export function parsePrettierOutput({ output, exitCode, cwd }) {
  if (exitCode === 0 || !/\[warn\]\s+Code style issues/.test(output)) return [];
  return output
    .split('\n')
    .map((line) => /^\[warn\]\s+(.+)$/.exec(line.trim())?.[1])
    .filter((file) => file && !/^Code style issues/.test(file) && (!cwd || existsSync(path.resolve(cwd, file))))
    .map((file) => ({ title: 'not formatted with Prettier', file, line: null, detail: null }));
}
