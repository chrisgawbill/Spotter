import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Parses a Vitest JSON report (`--reporter=json --outputFile={output}`):
 * one finding per failed test, plus suites that failed to load.
 */
export function parseVitestReport({ reportFile, cwd }) {
  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'));
  } catch {
    return [];
  }
  const findings = [];
  for (const suite of report.testResults ?? []) {
    const file = path.relative(cwd, suite.name);
    const failedTests = (suite.assertionResults ?? []).filter((test) => test.status === 'failed');
    for (const test of failedTests) {
      const failure = cleanStack(test.failureMessages?.join('\n') ?? '', cwd);
      findings.push({
        title: `test failed: ${test.fullName ?? test.title}`,
        file,
        line: test.location?.line ?? lineInFile(failure, file),
        detail: firstLines(failure, 4),
      });
    }
    if (suite.status === 'failed' && failedTests.length === 0) {
      findings.push({ title: 'test file failed to run', file, line: null, detail: firstLines(cleanStack(suite.message ?? '', cwd), 4) });
    }
  }
  return findings;
}

/** Drops stack frames inside dependencies and makes the rest relative to the working directory. */
function cleanStack(text, cwd) {
  return text
    .split('\n')
    .filter((line) => !/node_modules|node:internal|<anonymous>/.test(line))
    .map((line) => line.replaceAll(`file://${cwd}/`, '').replaceAll(`${cwd}/`, ''))
    .join('\n');
}

/** The first line number a stack trace reports for `file`. */
function lineInFile(stack, file) {
  const match = new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(stack);
  return match ? Number(match[1]) : null;
}

function firstLines(text, count) {
  return text.split('\n').filter((line) => line.trim()).slice(0, count).join('\n');
}
