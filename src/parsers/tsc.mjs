const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** Parses `tsc --pretty false` output: one finding per error, continuation lines kept as detail. */
export function parseTscOutput({ output }) {
  const findings = [];
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line.trim());
    if (match) {
      const [, file, lineNumber, , code, message] = match;
      findings.push({ title: `${code}: ${message}`, file, line: Number(lineNumber), detail: null });
    } else if (findings.length && /^\s{2,}\S/.test(line)) {
      const current = findings[findings.length - 1];
      current.detail = current.detail ? `${current.detail}\n${line.trim()}` : line.trim();
    }
  }
  return findings;
}
