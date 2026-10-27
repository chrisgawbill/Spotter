import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readSessionState, redactSecrets } from '../sessions.mjs';
import { runCommand, lastLines } from '../exec.mjs';
import { createFinding } from '../findings.mjs';

const require = createRequire(import.meta.url);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

/** Run the project's named Playwright tests against the already-built app. */
export async function runSpecsStage({ config, workdir, logDir, fixtures, appOrigin, projects = null }) {
  const { findings, summary } = await runSpecs({ config, workdir, logDir, fixtures, appOrigin, projects });
  return { findings, summary };
}

/** Re-runs timed specs; returns samples per interaction metric. */
export async function runTimedSpecs({ config, workdir, logDir, fixtures, appOrigin, project, samples, grep }) {
  try {
    const { report } = await runSpecs({ config, workdir, logDir, fixtures, appOrigin, projects: project ? [project] : null }, { dirName: 'specs-timing', repeatEach: samples, workers: 1, grep });
    const collected = {};
    const walk = (suites) => {
      for (const suite of suites ?? []) {
        for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const result of test.results ?? []) for (const attachment of result.attachments ?? []) {
          if (attachment.name !== 'spotter-timing' || !attachment.body) continue;
          const { name, ms } = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
          (collected[`interaction.${name}`] ??= []).push(ms);
        }
        walk(suite.suites);
      }
    };
    walk(report?.suites);
    return Object.keys(collected).length ? { samples: collected, error: null } : { samples: {}, error: 'no spotterTiming samples' };
  } catch (error) {
    return { samples: {}, error: String(error.message).split('\n')[0] };
  }
}

async function runSpecs({ config, workdir, logDir, fixtures, appOrigin, projects }, { dirName = 'specs', repeatEach, workers: workersOverride, grep: grepOverride } = {}) {
  const specs = config.web.specs;
  const live = specs.mode === 'live';
  const workers = workersOverride ?? (live ? 1 : (specs.workers ?? 1));
  const grep = grepOverride ?? specs.grep;
  const required = specs.live?.env ?? [];
  if (live) for (const name of required) {
    if (!process.env[name]?.trim()) throw new Error(`Live authentication requires environment variable ${name}`);
  }
  const secrets = required.map((name) => process.env[name]).filter(Boolean);
  for (const session of live ? [] : config.web.sessions) {
    const state = await readSessionState(session);
    secrets.push(...state.cookies.map((cookie) => cookie.value), ...state.origins.flatMap((entry) => (entry.localStorage ?? []).map((item) => item.value)));
  }
  const redact = (value) => redactSecrets(value, secrets);
  const dir = path.join(logDir, dirName);
  await mkdir(dir, { recursive: true });
  const privateDir = await mkdtemp(path.join(os.tmpdir(), 'spotter-spec-run-'));
  const reportFile = path.join(privateDir, 'results.json');
  const settingsFile = path.join(privateDir, 'settings.json');
  const configFile = path.join(dir, 'playwright.config.mjs');
  let result;
  let report;
  try {
    await writeFile(settingsFile, JSON.stringify({ web: config.web, fixtures, appOrigin }));
    const testMatch = (live ? specs.live.files : specs.files).map((file) => path.resolve(workdir, file).replaceAll('\\', '/'));
    await writeFile(configFile, `const config = ${JSON.stringify({
      testDir: workdir, testMatch, workers, fullyParallel: workers > 1, retries: 0, forbidOnly: true, ...(repeatEach ? { repeatEach } : {}),
      outputDir: path.join(privateDir, 'artifacts'), reporter: [['json', { outputFile: reportFile }]],
      use: { baseURL: live ? specs.live.baseURL : `${appOrigin}${config.web.base.replace(/\/?$/, '/')}`, trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block', reducedMotion: 'reduce' },
      ...(!live && projects?.length ? { projects } : {}),
    })}; ${grep ? `config.grep = new RegExp(${JSON.stringify(grep)});` : ''} export default config;\n`);
    result = await runCommand(`${quote(process.execPath)} ${quote(path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'))} test --config ${quote(configFile)}`, {
      cwd: workdir, env: {
        ...Object.fromEntries(required.map((name) => [name, live ? process.env[name] : undefined])),
        SPOTTER_TEST_MODULE: new URL('./specsFixture.mjs', import.meta.url).href,
        SPOTTER_SPEC_SETTINGS: settingsFile,
      },
    });
    report = await readFile(reportFile, 'utf8').then(JSON.parse).catch(() => null);
    await writeFile(path.join(dir, 'run.log'), live ? 'Live authentication: raw output withheld to protect credentials.\n' : redact(result.output));
    if (!live && report) await writeFile(path.join(dir, 'results.json'), JSON.stringify(redact(report), null, 2));
  } finally {
    await rm(privateDir, { recursive: true, force: true });
  }
  const findings = report ? specFindings(redact(report), workdir) : [];
  const runnerFailed = Boolean(result.exitCode) && !findings.length;
  if (runnerFailed) findings.push(createFinding({ stage: 'web', check: 'project-spec', severity: 'high', title: 'project specs could not complete', detail: report?.errors?.map((error) => error.message).join('\n') || lastLines(result.output, 10), key: { reason: 'runner' } }));
  for (const finding of findings) finding.detail = live ? 'Live authentication failed; inspect the named project spec. Raw output and browser artifacts are withheld.' : redact(finding.detail ?? '');
  return { findings, summary: specSummary(report, runnerFailed, findings.length, live), report };
}

/** Counts for the stage summary; `completed` means the runner produced a report and did not fail outright. */
export function specSummary(report, runnerFailed, failed, live) {
  const stats = report?.stats;
  return { mode: live ? 'live' : 'replay', passed: stats?.expected ?? 0, failed, skipped: stats?.skipped ?? 0, flaky: stats?.flaky ?? 0,
    selected: stats ? (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0) + (stats.skipped ?? 0) : 0, completed: Boolean(report) && !runnerFailed };
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
