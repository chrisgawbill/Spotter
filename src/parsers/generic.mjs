import { lastLines } from '../exec.mjs';

/** A failed command with no specific parser: one finding carrying the log tail. */
export function parseGenericOutput({ exitCode, output }) {
  if (exitCode === 0) return [];
  return [{ title: `exited with code ${exitCode}`, detail: lastLines(output, 15) }];
}
