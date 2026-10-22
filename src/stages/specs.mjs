import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCommand, lastLines } from '../exec.mjs';
import { createFinding } from '../findings.mjs';

const require = createRequire(import.meta.url);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

/** Run the project's named Playwright tests against the already-built app. */
export async function runSpecsStage({ config, workdir, logDir, fixtures, appOrigin }) {
  const specs = config.web.specs;
  const dir = path.join(logDir, 'specs');
  await mkdir(dir, { recursive: true });
  const reportFile = path.join(dir, 'results.json');
  const settingsFile = path.join(dir, 'settings.json');
  const configFile = path.join(dir, 'playwright.config.mjs');
  await writeFile(settingsFile, JSON.stringify({ web: config.web, fixtures, appOrigin }));
  const testMatch = specs.files.map((file) => path.resolve(workdir, file).replaceAll('\\', '/'));
  await writeFile(configFile, `const config = ${JSON.stringify({
    testDir: workdir, testMatch, workers: 1, retries: 0, forbidOnly: true,
    outputDir: path.join(dir, 'artifacts'), reporter: [['json', { outputFile: reportFile }]],
    use: { baseURL: `${appOrigin}${config.web.base.replace(/\/?$/, '/')}`, serviceWorkers: 'block', reducedMotion: 'reduce' },
  })}; ${specs.grep ? `config.grep = new RegExp(${JSON.stringify(specs.grep)});` : ''} export default config;\n`);
  let result;
  try {
    result = await runCommand(`${quote(process.execPath)} ${quote(path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'))} test --config ${quote(configFile)}`, {
      cwd: workdir, logFile: path.join(dir, 'run.log'), env: {
        SPOTTER_TEST_MODULE: new URL('./specsFixture.mjs', import.meta.url).href,
        SPOTTER_SPEC_SETTINGS: settingsFile,
      },
    });
  } finally {
    await rm(settingsFile, { force: true });
  }
  const report = await readFile(reportFile, 'utf8').then(JSON.parse).catch(() => null);
  const findings = report ? specFindings(report, workdir) : [];
  if (result.exitCode && !findings.length) findings.push(createFinding({ stage: 'web', check: 'project-spec', severity: 'high', title: 'project specs could not complete', detail: report?.errors?.map((error) => error.message).join('\n') || lastLines(result.output, 10), key: { reason: 'runner' } }));
  return { findings, summary: { passed: report?.stats?.expected ?? 0, failed: findings.length, skipped: report?.stats?.skipped ?? 0 } };
}

/** Identify failures by file, test name and project, independently of source lines. */
export function specFindings(report, workdir) {
  const findings = [];
  const walk = (suites, parents = []) => {
    for (const suite of suites ?? []) {
      const titles = [...parents, suite.title];
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
        if (test.status !== 'unexpected') continue;
        const name = [...titles, spec.title].filter(Boolean).join(' › ');
        findings.push(createFinding({ stage: 'web', check: 'project-spec', severity: 'high',
          title: `project spec failed: ${name}`, file: path.isAbsolute(spec.file) ? path.relative(workdir, spec.file) : spec.file,
          line: spec.line, detail: test.results?.flatMap((r) => r.errors ?? []).map((e) => e.message).join('\n').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').slice(0, 2000),
          repro: `Run project spec: ${name}`, key: { test: name, project: test.projectName ?? '' },
        }));
      }
      walk(suite.suites, titles);
    }
  };
  walk(report.suites);
  return findings;
}
