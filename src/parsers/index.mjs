import { parseGenericOutput } from './generic.mjs';
import { parsePrettierOutput } from './prettier.mjs';
import { parseTscOutput } from './tsc.mjs';
import { parseVitestReport } from './vitest.mjs';

/**
 * Output parsers by config name. Each returns finding inputs
 * ({ title, file, line, detail }) for one check run.
 */
export const parsers = {
  generic: parseGenericOutput,
  tsc: parseTscOutput,
  vitest: parseVitestReport,
  prettier: parsePrettierOutput,
};
