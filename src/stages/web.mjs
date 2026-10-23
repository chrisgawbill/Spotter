import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runAccessibility, runKeyboardSmoke } from './accessibility.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { lastLines, runCommand } from '../exec.mjs';
import { findIneffectiveSchemes } from '../config-drift.mjs';
import { createFinding } from '../findings.mjs';
import { apiRequestMatcher, recordFixtures, recordingHeaders, replayFixtures } from '../fixtures.mjs';
import { startStaticServer } from '../staticServer.mjs';
import { findHorizontalOverflow, measureVisibleContent } from './pageProbes.mjs';
import { runSpecsStage } from './specs.mjs';
import { sessionStorageState, redactSecrets } from '../sessions.mjs';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

const QUIET_NETWORK_MS = 500;
const MAX_NETWORK_WAIT_MS = 15_000;

/**
 * Builds the app against the fake API origin, serves it, and visits every
 * route × viewport × colour scheme. In `sweep` mode it replays fixtures and
 * returns findings plus screenshots; in `record` mode it forwards API calls to
 * the live API and fills `recordedEntries`.
 */
export async function runWebStage({ config, workdir, logDir, screenshotDir, fixtures, mode = 'sweep', recordedEntries, log = () => {} }) {
  const web = config.web;
  if (web.specs?.mode === 'live') {
    log('live authentication specs');
    const specs = await runSpecsStage({ config, workdir, logDir, fixtures: null, appOrigin: new URL(web.specs.live.baseURL).origin });
    log('live authentication specs', 'done');
    return { findings: specs.findings, summary: { pages: 0, specs: specs.summary } };
  }
  log('web build');
  const build = await buildApp({ config, workdir, logDir });
  log('web build', 'done');
  if (build.finding) return { findings: [build.finding], summary: { built: false, pages: 0 } };

  const server = await startStaticServer(path.join(workdir, web.build.outDir), web.base);
  let browser;
  try {
    browser = await chromium.launch();
    const jobs = listPageJobs(web, mode);
    await mkdir(screenshotDir, { recursive: true });
    const results = await runPool(jobs, web.concurrency, (job) =>
      visitPage({ browser, job, config, fixtures, mode, recordedEntries, appOrigin: server.origin, screenshotDir, log }),
    );
    const faultJobs = [];
    if (mode === 'sweep' && web.api && web.faultInjection) {
      for (let i = 0; i < results.length; i++) {
        if (jobs[i].viewport.width !== toViewport(web.viewports[0]).width || jobs[i].colorScheme !== web.colorSchemes[0]) continue;
        for (const key of results[i].requests) {
          for (const kind of ['500', 'delay']) faultJobs.push({ job: jobs[i], healthy: results[i], fault: { ...web.faultInjection, key, kind } });
        }
      }
    }
    const faultResults = await runPool(faultJobs, web.concurrency, ({ job, fault, healthy }) =>
      visitPage({ browser, job, config, fixtures, mode, appOrigin: server.origin, screenshotDir, fault, healthy, log }),
    );
    const sessionChecks = {};
    for (const result of results) {
      if (result.sessionCheck == null) continue;
      const entry = (sessionChecks[result.job.session.name] ??= { checked: 0, failed: 0, examples: [] });
      entry.checked += 1;
      if (!result.sessionCheck) { entry.failed += 1; if (entry.examples.length < 3) entry.examples.push(result.where); }
    }
    const countFailed = (list, check) => list.filter((result) => result.findings.some((finding) => finding.check === check)).length;
    const shape = `${web.routes.length} routes × ${web.viewports.length} viewports × ${mode === 'record' ? 1 : web.colorSchemes.length} schemes × ${web.sessions.length} sessions`;
    if (mode === 'sweep' && web.specs) log('project specs');
    const specs = mode === 'sweep' && web.specs ? await runSpecsStage({ config, workdir, logDir, fixtures, appOrigin: server.origin }) : null;
    if (specs) log('project specs', 'done');
    const schemeFindings = mode === 'sweep' ? await findIneffectiveSchemes(web, results) : [];
    return { findings: [...results, ...faultResults].flatMap((result) => result.findings).concat(schemeFindings, specs?.findings ?? []), summary: { built: true, pages: jobs.length, shape, faultVisits: faultResults.length, pagesFailed: countFailed(results, 'navigation'), faultVisitsFailed: countFailed(faultResults, 'fault-navigation'), apiNotReplayed: [...new Set(results.flatMap((result) => result.apiNotReplayed ?? []))].sort(), sessionChecks, sessions: web.sessions.map((s) => s.name), accessibility: web.accessibility, keyboard: web.keyboard, variantCount: web.viewports.length * web.colorSchemes.length, ...(specs ? { specs: specs.summary } : {}) } };
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function buildApp({ config, workdir, logDir }) {
  const web = config.web;
  const env = { ...web.build.env, ...(web.api?.envVar ? { [web.api.envVar]: web.api.fakeOrigin } : {}) };
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
    web.viewports.flatMap((viewport) => schemes.flatMap((colorScheme) => web.sessions.map((session) => ({ route, viewport: toViewport(viewport), colorScheme, session })))),
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

async function visitPage({ browser, job, config, fixtures, mode, recordedEntries, appOrigin, screenshotDir, fault, healthy, log = () => {} }) {
  const web = config.web;
  const { route, viewport, colorScheme, session } = job;
  const requests = new Set();
  const notReplayed = new Set();
  let loading = [];
  let blank = false;
  let sessionCheck = null;
  let screenshot = null;
  const storageState = await sessionStorageState(session, appOrigin, web.colorSchemeStorage?.[colorScheme]);
  const secrets = session.storageState ? [...storageState.cookies.map((cookie) => cookie.value), ...storageState.origins.flatMap((origin) => origin.localStorage.map((entry) => entry.value))] : [];
  const sessionFixtures = session.name === 'anonymous' ? fixtures : { ...fixtures, entries: fixtures?.sessions?.[session.name] ?? {} };
  const screenshotName = `${route.name}-${viewport.width}-${colorScheme}-${session.name}${fault ? `-${fault.kind}-${createHash('sha1').update(fault.key).digest('hex').slice(0, 10)}` : ''}`;
  const where = redactSecrets(`${route.path} [${session.name}]${fault ? ` ${fault.kind} ${fault.key}` : ''} @${viewport.width} ${colorScheme}`, secrets);
  log(`browser: ${where}`);
  const problems = [];
  const report = (problem) => problems.push(problem);

  const context = await browser.newContext({ viewport, colorScheme, storageState, serviceWorkers: 'block', reducedMotion: 'reduce' });
  if (fixtures?.recordedAt) await context.clock.setFixedTime(new Date(fixtures.recordedAt));
  if (web.api && mode === 'record') {
    await recordFixtures(context, { fakeOrigin: web.api.fakeOrigin, apiPaths: web.api.paths, ...recordingHeaders(web.api, session), liveOrigin: web.api.recordFrom, appOrigin, entries: session.name === 'anonymous' ? recordedEntries.entries : (recordedEntries.sessions[session.name] ??= {}) });
  } else if (web.api) {
    await replayFixtures(context, {
      fakeOrigin: web.api.fakeOrigin,
      apiPaths: web.api.paths,
      appOrigin,
      fixtures: sessionFixtures,
      fault,
      onRequest: (key) => requests.add(key),
      onUnrecorded: (key) => report(unrecordedProblem(key, config)),
    });
  }

  const page = await context.newPage();
  const network = trackNetwork(page);
  watchPageProblems(page, { web, appOrigin, onNotReplayed: (endpoint, status) => {
    if (fault || mode !== 'sweep' || notReplayed.has(endpoint)) return;
    notReplayed.add(endpoint);
    report({
      check: 'api-not-replayed',
      severity: 'high',
      title: `API request answered with the app's HTML page: ${endpoint}`,
      detail: `The app asked for data on its own origin and got its HTML page (HTTP ${status}).\nConfigure web.api.paths for this prefix and record fixtures, or add it to web.ignoreRequests if intended.`,
      key: { route: null, viewport: null, colorScheme: null, session: null, endpoint },
    });
  }, report: (problem) => {
    if (!fault) report(problem);
    else if (problem.check === 'uncaught-error' && !healthy.findings.some((finding) => finding.check === 'uncaught-error' && finding.title === problem.title)) report({ ...problem, check: 'fault-crash', title: `page crashes during ${fault.kind} response` });
  } });

  try {
    await page.goto(`${appOrigin}${web.base.replace(/\/?$/, '/')}${route.path.replace(/^\//, '')}`, { waitUntil: 'load', timeout: web.pageTimeoutMs });
    if (fault) await page.waitForTimeout(fault.timeoutMs);
    else {
      await network.waitForQuiet();
      await page.waitForTimeout(web.settleMs);
    }
    if (mode === 'sweep') {
      if (!fault && session.expectSelector) sessionCheck = (await page.locator(session.expectSelector).count()) > 0;
      const content = await page.evaluate(measureVisibleContent);
      blank = !content.textLength && !content.mediaCount;
      if (web.faultInjection) loading = await page.locator(web.faultInjection.loadingSelector).evaluateAll((elements) =>
        elements.filter((element) => element.checkVisibility()).map((element) => `${element.tagName}:${element.getAttribute('role') ?? ''}:${element.innerText?.trim() ?? ''}`),
      );
      if (fault) {
        if (blank && !healthy.blank) report({ check: 'fault-blank', severity: 'high', title: `page renders blank during ${fault.kind} response` });
        const remaining = [...healthy.loading];
        const addedLoading = loading.filter((indicator) => {
          const index = remaining.indexOf(indicator);
          if (index < 0) return true;
          remaining.splice(index, 1);
          return false;
        });
        if (addedLoading.length) report({
          check: 'fault-loading',
          severity: fault.kind === 'delay' ? 'low' : 'medium',
          title: `page still loading after ${fault.timeoutMs}ms during ${fault.kind} response`,
          detail: [fault.kind === 'delay'
            ? 'Advisory: deliberately delayed requests can legitimately keep a page loading.'
            : 'Observation deadline reached; verify the app retry budget before treating this as stuck.',
          ...addedLoading.slice(0, 3)].join('\n'),
        });
      } else {
        await probeRenderedPage(page, { web, report });
        if (web.accessibility) await runAccessibility(page, axePath, report);
      }
      const screenshotFile = path.join(screenshotDir, `${screenshotName}.png`);
      if (!session.storageState) {
        await page.screenshot({ path: screenshotFile, fullPage: true, animations: 'disabled' });
        screenshot = screenshotFile;
      }
      if (!fault && web.keyboard) await runKeyboardSmoke(page, report);
      problems.forEach((problem) => (problem.artifacts = session.storageState ? [] : [screenshotFile]));
    }
  } catch (error) {
    if (mode === 'record') throw error;
    if (!fault && mode === 'sweep' && session.expectSelector && sessionCheck === null) sessionCheck = false;
    report({ check: fault ? 'fault-navigation' : 'navigation', severity: 'high', title: `${fault ? `${fault.kind} ${fault.key}: ` : ''}page check failed: ${firstLine(error.message)}` });
  } finally {
    await context.close();
    log(`browser: ${where}`, 'done');
  }

  if (mode === 'record') return { findings: [] };
  return {
    requests: [...requests], apiNotReplayed: [...notReplayed], job, loading, blank, where, sessionCheck, screenshot,
    findings: redactSecrets(problems, secrets).map((problem) =>
      createFinding({
        stage: 'web',
        severity: problem.severity,
        check: problem.check,
        title: problem.title,
        detail: problem.detail ?? null,
        where,
        repro: problem.repro ?? null,
        artifacts: problem.artifacts ?? [],
        key: { route: route.path, viewport: viewport.width, colorScheme, session: session.name, ...(fault ? { endpoint: fault.key, fault: fault.kind } : {}), ...problem.key },
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
function watchPageProblems(page, { web, appOrigin, report, onNotReplayed }) {
  const isApi = web.api ? apiRequestMatcher({ fakeOrigin: web.api.fakeOrigin, apiPaths: web.api.paths, appOrigin }) : () => false;
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
    const parsed = new URL(url);
    const request = response.request();
    if (parsed.origin === appOrigin && !isApi(parsed)
      && (['fetch', 'xhr'].includes(request.resourceType()) || /json/i.test(request.headers().accept ?? ''))
      && /text\/html/i.test(response.headers()['content-type'] ?? '')
      && !isIgnored(web.ignoreRequests, url)) onNotReplayed(`${request.method()} ${parsed.pathname}`, response.status());
    if (response.status() < 400 || isIgnored(web.ignoreRequests, url)) return;
    if (isApi(parsed)) {
      // Unrecorded requests are already reported by the replay handler.
      if (!response.headers()['x-spotter-unrecorded'] && !response.headers()['x-spotter-injected']) report(apiErrorProblem(response));
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
function apiErrorProblem(response) {
  const request = response.request();
  const { pathname, search } = new URL(request.url());
  return {
    check: 'api-error',
    severity: response.status() >= 500 ? 'medium' : 'low',
    title: `API answered ${response.status()}: ${request.method()} ${truncate(pathname + search, 140)}`,
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
