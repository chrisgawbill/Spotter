/** Parses `prettier --check` output: one finding per unformatted file. */
export function parsePrettierOutput({ output }) {
  return output
    .split('\n')
    .map((line) => /^\[warn\]\s+(.+)$/.exec(line.trim())?.[1])
    .filter((file) => file && !/^Code style issues/.test(file))
    .map((file) => ({ title: 'not formatted with Prettier', file, line: null, detail: null }));
}
