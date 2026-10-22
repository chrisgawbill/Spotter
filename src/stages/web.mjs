import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { lastLines, runCommand } from '../exec.mjs';
import { createFinding } from '../findings.mjs';
import { recordFixtures, replayFixtures } from '../fixtures.mjs';
import { startStaticServer } from '../staticServer.mjs';
import { findHorizontalOverflow, measureVisibleContent } from './pageProbes.mjs';

const QUIET_NETWORK_MS = 500;
const MAX_NETWORK_WAIT_MS = 15_000;

/**
 * Builds the app against the fake API origin, serves it, and visits every
 * route × viewport × colour scheme. In `sweep` mode it replays fixtures and
 * returns findings plus screenshots; in `record` mode it forwards API calls to
 * the live API and fills `recordedEntries`.
 */
export async function runWebStage({ config, workdir, logDir, screenshotDir, fixtures, mode = 'sweep', recordedEntries }) {
  const web = config.web;
  const build = await buildApp({ config, workdir, logDir });
  if (build.finding) return { findings: [build.finding], summary: { built: false, pages: 0 } };

  const server = await startStaticServer(path.join(workdir, web.build.outDir), web.base);
  const browser = await chromium.launch();
  try {
    const jobs = listPageJobs(web, mode);
    await mkdir(screenshotDir, { recursive: true });
    const results = await runPool(jobs, web.concurrency, (job) =>
      visitPage({ browser, job, config, fixtures, mode, recordedEntries, appOrigin: server.origin, screenshotDir }),
    );
    const shape = `${web.routes.length} routes × ${web.viewports.length} viewports × ${mode === 'record' ? 1 : web.colorSchemes.length} schemes`;
    return { findings: results.flatMap((result) => result.findings), summary: { built: true, pages: jobs.length, shape, variantCount: web.viewports.length * web.colorSchemes.length } };
  } finally {
    await browser.close();
    await server.close();
  }
}

async function buildApp({ config, workdir, logDir }) {
  const web = config.web;
  const env = { ...web.build.env, ...(web.api ? { [web.api.envVar]: web.api.fakeOrigin } : {}) };
  const result = await runCommand(web.build.run, { cwd: workdir, env, logFile: path.join(logDir, 'web-build.log') });
  if (result.exitCode === 0) return {};
  return {
    finding: createFinding({
      stage: 'web',
      check: 'build',
      severity: 'high',
      title: `build failed (exit ${result.exitCode})`,
      detail: lastLines(result.output, 15),
      repro: `cd ${config.workdir} && ${web.build.run}`,
    }),
  };
}

/** Every page visit for the run; recording only needs one colour scheme. */
function listPageJobs(web, mode) {
  const schemes = mode === 'record' ? web.colorSchemes.slice(0, 1) : web.colorSchemes;
  return web.routes.flatMap((route) =>
    web.viewports.flatMap((viewport) => schemes.map((colorScheme) => ({ route, viewport: toViewport(viewport), colorScheme }))),
  );
}

function toViewport(viewport) {
  if (typeof viewport === 'object') return viewport;
  if (viewport < 600) return { width: viewport, height: 812 };
  if (viewport < 1000) return { width: viewport, height: 1024 };
  return { width: viewport, height: 800 };
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving order. */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function visitPage({ browser, job, config, fixtures, mode, recordedEntries, appOrigin, screenshotDir }) {
  const web = config.web;
  const { route, viewport, colorScheme } = job;
  const screenshotName = `${route.name}-${viewport.width}-${colorScheme}`;
  const where = `${route.path} @${viewport.width} ${colorScheme}`;
  const problems = [];
  const report = (problem) => problems.push(problem);

  const context = await browser.newContext({ viewport, colorScheme, serviceWorkers: 'block', reducedMotion: 'reduce' });
  if (fixtures?.recordedAt) await context.clock.setFixedTime(new Date(fixtures.recordedAt));
  const seededStorage = web.colorSchemeStorage?.[colorScheme];
  if (seededStorage) {
    // Apps with their own theme switch read it from storage rather than prefers-color-scheme.
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, seededStorage);
  }
  if (web.api && mode === 'record') {
    await recordFixtures(context, { fakeOrigin: web.api.fakeOrigin, liveOrigin: web.api.recordFrom, appOrigin, entries: recordedEntries });
  } else if (web.api) {
    await replayFixtures(context, {
      fakeOrigin: web.api.fakeOrigin,
      appOrigin,
      fixtures,
      onUnrecorded: (key) => report(unrecordedProblem(key, config)),
    });
  }

  const page = await context.newPage();
  const network = trackNetwork(page);
  watchPageProblems(page, { web, appOrigin, report });

  try {
    await page.goto(`${appOrigin}${web.base}${route.path}`, { waitUntil: 'load', timeout: web.pageTimeoutMs });
    await network.waitForQuiet();
    await page.waitForTimeout(web.settleMs);
    if (mode === 'sweep') {
      await probeRenderedPage(page, { web, report });
      const screenshotFile = path.join(screenshotDir, `${screenshotName}.png`);
      await page.screenshot({ path: screenshotFile, fullPage: true, animations: 'disabled' });
      problems.forEach((problem) => (problem.artifacts = [screenshotFile]));
    }
  } catch (error) {
    report({ check: 'navigation', severity: 'high', title: `page did not finish loading: ${firstLine(error.message)}` });
  } finally {
    await context.close();
  }

  if (mode === 'record') return { findings: [] };
  return {
    findings: problems.map((problem) =>
      createFinding({
        stage: 'web',
        severity: problem.severity,
        check: problem.check,
        title: problem.title,
        detail: problem.detail ?? null,
        where,
        repro: problem.repro ?? null,
        artifacts: problem.artifacts ?? [],
        key: { route: route.path, viewport: viewport.width, colorScheme },
      }),
    ),
  };
}

/** Counts in-flight requests so a visit can wait until the page stops fetching. */
function trackNetwork(page) {
  let pendingRequestCount = 0;
  let lastActivity = Date.now();
  const onRequestSettled = () => {
    pendingRequestCount = Math.max(0, pendingRequestCount - 1);
    lastActivity = Date.now();
  };
  page.on('request', () => {
    pendingRequestCount += 1;
    lastActivity = Date.now();
  });
  page.on('requestfinished', onRequestSettled);
  page.on('requestfailed', onRequestSettled);
  return {
    async waitForQuiet() {
      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_NETWORK_WAIT_MS) {
        if (pendingRequestCount === 0 && Date.now() - lastActivity >= QUIET_NETWORK_MS) return;
        await page.waitForTimeout(100);
      }
    },
  };
}

/** Reports uncaught errors, console errors and failed requests as they happen. */
function watchPageProblems(page, { web, appOrigin, report }) {
  const isIgnored = (patterns, text) => patterns.some((pattern) => new RegExp(pattern, 'i').test(text));

  page.on('pageerror', (error) =>
    report({ check: 'uncaught-error', severity: 'high', title: `uncaught ${error.name}: ${firstLine(error.message)}`, detail: topStackFrames(error.stack) }),
  );
  page.on('console', (message) => {
    const text = message.text();
    // Chromium logs every failed resource as a console error; request checks already cover those.
    if (message.type() !== 'error' || /^Failed to load resource/.test(text) || isIgnored(web.ignoreConsole, text)) return;
    const location = message.location();
    report({
      check: 'console-error',
      severity: 'medium',
      title: `console error: ${truncate(firstLine(text), 160)}`,
      detail: location?.url ? `at ${location.url.replace(appOrigin, '')}:${location.lineNumber}` : null,
    });
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() < 400 || isIgnored(web.ignoreRequests, url)) return;
    if (web.api && url.startsWith(web.api.fakeOrigin)) {
      // Unrecorded requests are already reported by the replay handler.
      if (!response.headers()['x-spotter-unrecorded']) report(apiErrorProblem(response, web.api.fakeOrigin));
      return;
    }
    report(requestProblem(response.request(), `HTTP ${response.status()}`, appOrigin));
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    const reason = request.failure()?.errorText ?? 'failed';
    if (reason.includes('ERR_ABORTED') || isIgnored(web.ignoreRequests, url)) return;
    report(requestProblem(request, reason, appOrigin));
  });
}

function requestProblem(request, reason, appOrigin) {
  const url = request.url();
  const isOwnAsset = url.startsWith(appOrigin);
  const shownUrl = isOwnAsset ? url.slice(appOrigin.length) : url.replace(/\?.*$/, '');
  return {
    check: isOwnAsset ? 'asset-request' : 'external-request',
    severity: isOwnAsset ? 'medium' : 'low',
    title: `${request.resourceType()} request failed (${reason}): ${truncate(shownUrl, 140)}`,
  };
}

/** A recorded API error replayed to the app: 5xx is worth a look, 4xx is usually deliberate (signed out). */
function apiErrorProblem(response, fakeOrigin) {
  const request = response.request();
  return {
    check: 'api-error',
    severity: response.status() >= 500 ? 'medium' : 'low',
    title: `API answered ${response.status()}: ${request.method()} ${truncate(request.url().slice(fakeOrigin.length), 140)}`,
  };
}

function unrecordedProblem(key, config) {
  return {
    check: 'unrecorded-request',
    severity: 'medium',
    title: `API request not in fixtures: ${key}`,
    detail: 'The app called an endpoint (or query) the fixtures lack; it got a 404. If the call is intended, re-record.',
    repro: `spotter record ${config.name} --ref <this branch>`,
  };
}

/** Layout and content checks on the settled page. */
async function probeRenderedPage(page, { web, report }) {
  const overflow = await page.evaluate(findHorizontalOverflow);
  if (overflow) {
    const scrolls = overflow.kind === 'scrolls';
    report({
      check: scrolls ? 'horizontal-overflow' : 'cut-off-content',
      severity: 'medium',
      title: scrolls ? 'page scrolls sideways' : 'content cut off at the right edge',
      detail: `${overflow.overflowPx}px past the viewport; sticking out: ${overflow.elements.join('; ') || 'unknown'}`,
    });
  }
  const content = await page.evaluate(measureVisibleContent);
  if (content.textLength === 0 && content.mediaCount === 0) {
    report({ check: 'blank-page', severity: 'high', title: 'page rendered blank' });
  }
  for (const errorText of web.errorText) {
    if (content.text.includes(errorText)) {
      report({ check: 'error-text', severity: 'medium', title: `page shows error text "${errorText}"` });
    }
  }
}

const firstLine = (text) => String(text ?? '').split('\n')[0];
const truncate = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const topStackFrames = (stack) =>
  String(stack ?? '')
    .split('\n')
    .filter((line) => line.trim().startsWith('at '))
    .slice(0, 3)
    .map((line) => line.trim())
    .join('\n') || null;
