import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runAccessibility, runKeyboardSmoke } from './accessibility.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices, firefox, webkit } from 'playwright';
import { DEFAULT_TARGET_ID, isDefaultMatrix, listTargets } from '../browsers.mjs';
import { lastLines, runCommand } from '../exec.mjs';
import { DEFAULT_FAULT_KINDS } from '../levels.mjs';
import { findIneffectiveSchemes } from '../config-drift.mjs';
import { createFinding } from '../findings.mjs';
import { apiRequestMatcher, isExpectedStatus, recordFixtures, recordingHeaders, replayFixtures } from '../fixtures.mjs';
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
  const targets = listTargets(web);
  targets.forEach((target) => target.device && deviceOptions(target.device));
  log('web build');
  const build = await buildApp({ config, workdir, logDir });
  log('web build', 'done');
  if (build.finding) return { findings: [build.finding], summary: { built: false, pages: 0 } };

  const server = await startStaticServer(path.join(workdir, web.build.outDir), web.base);
  let browsers = new Map();
  try {
    browsers = await launchBrowsers([...new Set((mode === 'record' ? targets.slice(0, 1) : targets).map((target) => target.browser ?? deviceOptions(target.device).engine))]);
    const jobs = listPageJobs(web, mode);
    await mkdir(screenshotDir, { recursive: true });
    const healthyStarted = Date.now();
    const results = await runPool(jobs, web.concurrency, (job) =>
      visitPage({ browsers, job, config, fixtures, mode, recordedEntries, appOrigin: server.origin, screenshotDir, log }),
    );
    const healthyMs = Date.now() - healthyStarted;
    const faultJobs = [];
    if (mode === 'sweep' && web.api && web.faultInjection) {
      for (let i = 0; i < results.length; i++) {
        if (jobs[i].target.id !== targets[0].id || jobs[i].viewport.width !== toViewport(web.viewports[0]).width || jobs[i].colorScheme !== web.colorSchemes[0]) continue;
        if (web.faultInjection.routes && !web.faultInjection.routes.includes(jobs[i].route.name)) continue;
        for (const key of results[i].requests) {
          for (const kind of web.faultInjection.kinds ?? DEFAULT_FAULT_KINDS) faultJobs.push({ job: jobs[i], healthy: results[i], fault: { ...web.faultInjection, key, kind } });
        }
      }
    }
    const faultsStarted = Date.now();
    const faultResults = await runPool(faultJobs, web.faultInjection?.concurrency ?? web.concurrency, ({ job, fault, healthy }) =>
      visitPage({ browsers, job, config, fixtures, mode, appOrigin: server.origin, screenshotDir, fault, healthy, log }),
    );
    const faultsMs = Date.now() - faultsStarted;
    const sessionChecks = {};
    for (const result of results) {
      if (result.sessionCheck == null) continue;
      const entry = (sessionChecks[result.job.session.name] ??= { checked: 0, failed: 0, examples: [] });
      entry.checked += 1;
      if (!result.sessionCheck) { entry.failed += 1; if (entry.examples.length < 3) entry.examples.push(result.where); }
    }
    const countFailed = (list, check) => list.filter((result) => result.findings.some((finding) => finding.check === check)).length;
    const targetPages = targets.map((target) => ({ id: target.id, label: target.label, pages: jobs.filter((job) => job.target.id === target.id).length }));
    const shape = `${web.routes.length} routes × ${web.viewports.length} viewports × ${mode === 'record' ? 1 : web.colorSchemes.length} schemes × ${web.sessions.length} sessions${isDefaultMatrix(web) ? '' : ` in ${targetPages.map((target) => `${target.label} ${target.pages}`).join(', ')}`}`;
    const projects = isDefaultMatrix(web) ? null : targets.map((target) => ({ name: target.id, use: target.device ? devices[target.device] : { browserName: target.browser } }));
    if (mode === 'sweep' && web.specs) log('project specs');
    const specsStarted = Date.now();
    const specs = mode === 'sweep' && web.specs ? await runSpecsStage({ config, workdir, logDir, fixtures, appOrigin: server.origin, projects }) : null;
    const specsMs = specs ? Date.now() - specsStarted : 0;
    if (specs) log('project specs', 'done');
    const schemeFindings = mode === 'sweep' ? await findIneffectiveSchemes(web, results) : [];
    return { findings: [...results, ...faultResults].flatMap((result) => result.findings).concat(schemeFindings, specs?.findings ?? []), summary: { built: true, timings: { healthyMs, faultsMs, specsMs }, faultEarlyCompletions: faultResults.filter((result) => result.completedEarly).length, faultRoutes: web.api && web.faultInjection ? web.faultInjection.routes ?? web.routes.map((route) => route.name) : [], pages: jobs.length, shape, targets: targetPages, faultVisits: faultResults.length, pagesFailed: countFailed(results, 'navigation'), faultVisitsFailed: countFailed(faultResults, 'fault-navigation'), apiNotReplayed: [...new Set(results.flatMap((result) => result.apiNotReplayed ?? []))].sort(), sessionChecks, sessions: web.sessions.map((s) => s.name), accessibility: web.accessibility, keyboard: web.keyboard, variantCount: web.viewports.length * web.colorSchemes.length, ...(specs ? { specs: specs.summary } : {}) } };
  } finally {
    await Promise.all([...browsers.values()].map((browser) => browser.close()));
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

/** Launches one browser per engine; on failure closes the ones already up. */
export async function launchBrowsers(engines, types = { chromium, firefox, webkit }) {
  const launched = new Map();
  try {
    for (const engine of engines) {
      try {
        launched.set(engine, await types[engine].launch());
      } catch (error) {
        throw new Error(`Cannot launch ${engine}: ${firstLine(error.message)}. Rebuild the Spotter image (bin/spotter build-image); ${engine} is needed at level high and wherever web.browsers or web.devices use it.`);
      }
    }
  } catch (error) {
    await Promise.all([...launched.values()].map((browser) => browser.close()));
    throw error;
  }
  return launched;
}

/** Playwright context options for a named device, and the engine that runs it. */
export function deviceOptions(name) {
  if (!Object.hasOwn(devices, name)) throw new Error(`Unknown Playwright device "${name}" in web.devices; use a name from Playwright's device list such as "iPhone 13".`);
  const { defaultBrowserType, ...options } = devices[name];
  return { engine: defaultBrowserType, options };
}

/** Every page visit for the run: each matrix case, or only the primary one when recording. */
function listPageJobs(web, mode) {
  const schemes = mode === 'record' ? web.colorSchemes.slice(0, 1) : web.colorSchemes;
  const targets = mode === 'record' ? listTargets(web).slice(0, 1) : listTargets(web);
  return targets.flatMap((target) => web.routes.flatMap((route) =>
    (target.device ? [deviceOptions(target.device).options.viewport] : web.viewports.map(toViewport)).flatMap((viewport) =>
      schemes.flatMap((colorScheme) => web.sessions.map((session) => ({ route, viewport, colorScheme, session, target }))),
    ),
  ));
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

async function visitPage({ browsers, job, config, fixtures, mode, recordedEntries, appOrigin, screenshotDir, fault, healthy, log = () => {} }) {
  const web = config.web;
  const { route, viewport, colorScheme, session, target } = job;
  const primary = target.id === listTargets(web)[0].id;
  const device = target.device ? deviceOptions(target.device) : null;
  const browser = browsers.get(device?.engine ?? target.browser);
  const suffix = target.id === DEFAULT_TARGET_ID ? '' : target.id;
  const requests = new Set();
  const notReplayed = new Set();
  let loading = [];
  let blank = false;
  let sessionCheck = null;
  let screenshot = null;
  let terminalPresent = false;
  let completedEarly = false;
  const storageState = await sessionStorageState(session, appOrigin, web.colorSchemeStorage?.[colorScheme]);
  const secrets = session.storageState ? [...storageState.cookies.map((cookie) => cookie.value), ...storageState.origins.flatMap((origin) => origin.localStorage.map((entry) => entry.value))] : [];
  const sessionFixtures = session.name === 'anonymous' ? fixtures : { ...fixtures, entries: fixtures?.sessions?.[session.name] ?? {} };
  const screenshotName = `${route.name}-${viewport.width}-${colorScheme}-${session.name}${suffix && `-${suffix}`}${fault ? `-${fault.kind}-${createHash('sha1').update(fault.key).digest('hex').slice(0, 10)}` : ''}`;
  const where = redactSecrets(`${route.path} [${session.name}]${fault ? ` ${fault.kind} ${fault.key}` : ''} @${viewport.width} ${colorScheme}${suffix && ` ${target.label}`}`, secrets);
  log(`browser: ${where}`);
  const problems = [];
  const report = (problem) => problems.push(problem);

  const context = await browser.newContext({ ...device?.options, viewport, colorScheme, storageState, serviceWorkers: 'block', reducedMotion: 'reduce' });
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
      key: { route: null, viewport: null, colorScheme: null, session: null, browser: undefined, endpoint },
    });
  }, report: (problem) => {
    if (!fault) report(problem);
    else if (problem.check === 'uncaught-error' && !healthy.findings.some((finding) => finding.check === 'uncaught-error' && finding.title === problem.title)) report({ ...problem, check: 'fault-crash', title: `page crashes during ${fault.kind} response` });
  } });

  try {
    await page.goto(`${appOrigin}${web.base.replace(/\/?$/, '/')}${route.path.replace(/^\//, '')}`, { waitUntil: 'load', timeout: web.pageTimeoutMs });
    if (fault) completedEarly = await observeFault(page, { fault, healthy, requests, network });
    else {
      await network.waitForQuiet();
      await page.waitForTimeout(web.settleMs);
    }
    if (mode === 'sweep') {
      if (!fault && web.faultInjection?.terminalSelector) terminalPresent = await hasVisibleMatch(page, web.faultInjection.terminalSelector);
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
        if (primary && web.accessibility) await runAccessibility(page, axePath, report);
      }
      const screenshotFile = path.join(screenshotDir, `${screenshotName}.png`);
      if (!session.storageState) {
        await page.screenshot({ path: screenshotFile, fullPage: true, animations: 'disabled' });
        screenshot = screenshotFile;
      }
      if (!fault && primary && web.keyboard) await runKeyboardSmoke(page, report);
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
    terminalPresent, completedEarly, requests: [...requests], apiNotReplayed: [...notReplayed], job, loading, blank, where, sessionCheck, screenshot,
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
        key: { route: route.path, viewport: viewport.width, colorScheme, session: session.name, ...(suffix ? { browser: target.id } : {}), ...(fault ? { endpoint: fault.key, fault: fault.kind } : {}), ...problem.key },
      }),
    ),
  };
}

async function hasVisibleMatch(page, selector) {
  return page.locator(selector).evaluateAll((elements) => elements.some((element) => element.checkVisibility()));
}

/** A configured terminal state can shorten observation, never a deliberate delay. */
export async function observeFault(page, { fault, healthy, requests, network }) {
  if (!fault.terminalSelector || fault.kind === 'delay' || healthy.terminalPresent) {
    await page.waitForTimeout(fault.timeoutMs);
    return false;
  }
  const started = Date.now();
  await page.waitForTimeout(fault.minObservationMs);
  let terminalSince = null;
  while (Date.now() - started < fault.timeoutMs) {
    const terminal = requests.has(fault.key) && network.isQuiet() && await hasVisibleMatch(page, fault.terminalSelector) && !await hasVisibleMatch(page, fault.loadingSelector);
    if (!terminal) terminalSince = null;
    else {
      terminalSince ??= Date.now();
      if (Date.now() - terminalSince >= QUIET_NETWORK_MS) return true;
    }
    await page.waitForTimeout(Math.min(100, Math.max(0, fault.timeoutMs - (Date.now() - started))));
  }
  return false;
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
    isQuiet: () => pendingRequestCount === 0 && Date.now() - lastActivity >= QUIET_NETWORK_MS,
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
      // Injected fault responses are judged by the fault checks; expected statuses are handled by the app on purpose.
      if (!response.headers()['x-spotter-unrecorded'] && !response.headers()['x-spotter-injected']
        && !isExpectedStatus(web.api.expectedStatuses, request.method(), parsed.pathname, response.status())) report(apiErrorProblem(response));
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
