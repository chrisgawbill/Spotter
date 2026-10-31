import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runAccessibility, runKeyboardSmoke } from './accessibility.mjs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
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
import { absoluteBudgetFindings, aggregate, measureBuild, routeMetrics } from '../performance.mjs';
import { runSpecsStage, runTimedSpecs } from './specs.mjs';
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
export async function runWebStage({ config, workdir, logDir, screenshotDir, fixtures, mode = 'sweep', recordedEntries, timingGate, log = () => {} }) {
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
  const buildStarted = Date.now();
  const build = await buildApp({ config, workdir, logDir });
  const buildMs = Date.now() - buildStarted;
  log('web build', 'done');
  if (build.finding) return { findings: [build.finding], summary: { built: false, pages: 0, timings: { buildMs } } };
  const perf = mode === 'sweep' ? web.performance : null;
  const buildMetrics = perf ? await measureBuild(path.join(workdir, web.build.outDir)) : null;

  const server = await startStaticServer(path.join(workdir, web.build.outDir), web.base);
  let browsers = new Map();
  try {
    browsers = await launchBrowsers([...new Set((mode === 'record' ? targets.slice(0, 1) : targets).map((target) => target.browser ?? deviceOptions(target.device).engine))]);
    const jobs = listPageJobs(web, mode);
    const primaryJobs = new Map();
    if (perf) for (const job of jobs) if (job.target.id === targets[0].id && job.colorScheme === web.colorSchemes[0] && job.session.name === 'anonymous' && !primaryJobs.has(job.route.name)) primaryJobs.set(job.route.name, job);
    await mkdir(screenshotDir, { recursive: true });
    const healthyStarted = Date.now();
    const targetSpans = {};
    const results = await runPool(jobs, web.concurrency, async (job) => {
      const started = Date.now();
      try {
        return await visitPage({ browsers, job, config, fixtures, mode, recordedEntries, appOrigin: server.origin, screenshotDir, measure: primaryJobs.get(job.route.name) === job, log });
      } finally {
        const span = (targetSpans[job.target.label] ??= { started, ended: 0 });
        span.started = Math.min(span.started, started);
        span.ended = Date.now();
      }
    });
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
    const shape = `${web.routes.length} routes × ${web.viewports.length} viewports × ${mode === 'record' ? 1 : web.colorSchemes.length} schemes × ${web.sessions.length} sessions${isDefaultMatrix(web) ? '' : ` in ${targetPages.map((target, index) => `${target.label} ${target.pages}${index && web.sampleSecondary ? ' sampled' : ''}`).join(', ')}`}`;
    const projects = isDefaultMatrix(web) ? null : targets.map((target, index) => ({
      name: target.id,
      use: target.device ? devices[target.device] : { browserName: target.browser },
      ...(index && web.sampleSecondary && web.specs?.matrixGrep ? { grep: web.specs.matrixGrep } : {}),
    }));
    if (mode === 'sweep' && web.specs) log('project specs');
    const specsStarted = Date.now();
    const specs = web.specs ? await runSpecsStage({ config, workdir, logDir, fixtures: mode === 'record' ? { ...recordedEntries, recordedAt: fixtures.recordedAt } : fixtures, appOrigin: server.origin, projects: mode === 'sweep' ? projects : null, recordMissing: mode === 'record' ? recordedEntries : null }) : null;
    const specsMs = specs ? Date.now() - specsStarted : 0;
    if (specs) log('project specs', 'done');
    const schemeFindings = mode === 'sweep' ? await findIneffectiveSchemes(web, results) : [];
    let performance = null;
    const performanceStarted = Date.now();
    if (perf) {
      const resources = { ...buildMetrics };
      for (const result of results) if (result.traffic) Object.assign(resources, routeMetrics(result.job.route.name, result.traffic));
      performance = { resources, ...await sampleTimings({ config, workdir, logDir, fixtures, appOrigin: server.origin, targets, projects, browsers, primaryJobs, timingGate, log }) };
    }
    const performanceMs = perf ? Date.now() - performanceStarted : 0;
    const matrix = isDefaultMatrix(web) ? null : Object.fromEntries(Object.entries(targetSpans).map(([label, span]) => [label, span.ended - span.started]));
    const budgetFindings = performance ? absoluteBudgetFindings(perf, performance, { project: config.name }) : [];
    return { findings: [...results, ...faultResults].flatMap((result) => result.findings).concat(schemeFindings, specs?.findings ?? [], budgetFindings), summary: { built: true, timings: { buildMs, healthyMs, faultsMs, specsMs, performanceMs, ...(matrix ? { matrix } : {}) }, faultEarlyCompletions: faultResults.filter((result) => result.completedEarly).length, faultRoutes: web.api && web.faultInjection ? web.faultInjection.routes ?? web.routes.map((route) => route.name) : [], pages: jobs.length, shape, targets: targetPages, faultVisits: faultResults.length, pagesFailed: countFailed(results, 'navigation'), faultVisitsFailed: countFailed(faultResults, 'fault-navigation'), apiNotReplayed: [...new Set(results.flatMap((result) => result.apiNotReplayed ?? []))].sort(), sessionChecks, sessions: web.sessions.map((s) => s.name), accessibility: web.accessibility, keyboard: web.keyboard, variantCount: web.viewports.length * web.colorSchemes.length, ...(specs ? { specs: specs.summary } : {}), ...(performance ? { performance } : {}) } };
  } finally {
    await Promise.all([...browsers.values()].map((browser) => browser.close()));
    await server.close();
  }
}

/** Page-load and interaction samples for `web.performance.timings`; never throws, failures become `timingError`. */
async function sampleTimings({ config, workdir, logDir, fixtures, appOrigin, targets, projects, browsers, primaryJobs, timingGate, log }) {
  const web = config.web;
  const timings = web.performance.timings;
  if (!timings) return { timings: null, environment: null, timingError: null };
  const target = targets[0];
  const device = target.device ? deviceOptions(target.device) : null;
  const browser = browsers.get(device?.engine ?? target.browser);
  const turn = (fn) => (timingGate ? timingGate.turn(fn) : fn());
  const measured = {};
  let timingError = null;
  log('performance timings');
  try {
    await timingGate?.arrive();
    for (const name of timings.routes) {
      const samples = [];
      const missing = [];
      for (let i = 0; i < timings.samples && !missing.length; i++) samples.push(await turn(() => samplePageLoad({ browser, device, web, fixtures, appOrigin, job: primaryJobs.get(name), missing })));
      if (missing.length) timingError ??= `page-load sampling requested unrecorded API data without the frozen clock (${missing[0]})`;
      else measured[`timing.${name}.load`] = aggregate(samples);
    }
    if (timings.interactions) {
      const run = await turn(() => runTimedSpecs({ config, workdir, logDir, fixtures, appOrigin, project: projects?.[0] ?? null, samples: timings.samples, grep: timings.interactions.grep }));
      for (const [metric, samples] of Object.entries(run.samples)) measured[metric] = aggregate(samples);
      timingError ??= run.error;
    }
  } catch (error) {
    timingError = firstLine(error.message);
  } finally {
    timingGate?.done();
  }
  log('performance timings', 'done');
  const ran = Object.keys(measured).length > 0;
  return {
    timings: ran ? measured : null,
    environment: ran ? { browser: `${device?.engine ?? target.browser} ${browser.version()}`, cpus: os.cpus().length, api: web.api ? 'replayed' : 'none', samples: timings.samples } : null,
    timingError,
  };
}

/** Navigation start to the end of the load event, in a fresh context set up like the healthy visit. The clock is not frozen: Chromium returns no navigation timing entries under clock.setFixedTime. */
async function samplePageLoad({ browser, device, web, fixtures, appOrigin, job, missing }) {
  const { route, viewport, colorScheme, session } = job;
  const storageState = await sessionStorageState(session, appOrigin, web.colorSchemeStorage?.[colorScheme]);
  const context = await browser.newContext({ ...device?.options, viewport, colorScheme, storageState, serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    if (web.api) await replayFixtures(context, { fakeOrigin: web.api.fakeOrigin, apiPaths: web.api.paths, appOrigin, fixtures, onUnrecorded: (key) => missing.push(key) });
    const page = await context.newPage();
    await page.goto(`${appOrigin}${web.base.replace(/\/?$/, '/')}${route.path.replace(/^\//, '')}`, { waitUntil: 'load', timeout: web.pageTimeoutMs });
    await page.waitForFunction(() => performance.getEntriesByType('navigation')[0]?.loadEventEnd > 0);
    return await page.evaluate(() => performance.getEntriesByType('navigation')[0].loadEventEnd);
  } finally {
    await context.close();
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
  return targets.flatMap((target, targetIndex) => web.routes.flatMap((route, routeIndex) => {
    const viewports = target.device ? [deviceOptions(target.device).options.viewport] : web.viewports.map(toViewport);
    if (web.sampleSecondary && targetIndex) {
      const viewport = viewports[(routeIndex + targetIndex) % viewports.length];
      const colorScheme = schemes[(routeIndex + targetIndex) % schemes.length];
      return web.sessions.map((session) => ({ route, viewport, colorScheme, session, target }));
    }
    return viewports.flatMap((viewport) => schemes.flatMap((colorScheme) => web.sessions.map((session) => ({ route, viewport, colorScheme, session, target }))));
  }));
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

async function visitPage({ browsers, job, config, fixtures, mode, recordedEntries, appOrigin, screenshotDir, fault, healthy, measure = false, log = () => {} }) {
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
  let traffic = null;
  if (measure) {
    const isApi = web.api ? apiRequestMatcher({ fakeOrigin: web.api.fakeOrigin, apiPaths: web.api.paths, appOrigin }) : () => false;
    const counted = { requests: 0, apiRequests: 0, bytes: 0, imageBytes: 0, bodies: [], done: false };
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (counted.done || !/^https?:$/.test(url.protocol)) return;
      counted.requests += 1;
      if (isApi(url)) counted.apiRequests += 1;
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (counted.done || url.origin !== appOrigin || isApi(url)) return;
      counted.bodies.push(response.body().catch(() => null).then((body) => {
        counted.bytes += body?.length ?? 0;
        if (body && response.request().resourceType() === 'image') counted.imageBytes += body.length;
      }));
    });
    traffic = counted;
  }
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
      if (traffic) {
        traffic.done = true;
        await Promise.all(traffic.bodies);
      }
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
    if (traffic && !traffic.done) traffic = null;
    if (!fault && mode === 'sweep' && session.expectSelector && sessionCheck === null) sessionCheck = false;
    report({ check: fault ? 'fault-navigation' : 'navigation', severity: 'high', title: `${fault ? `${fault.kind} ${fault.key}: ` : ''}page check failed: ${firstLine(error.message)}` });
  } finally {
    await context.close();
    log(`browser: ${where}`, 'done');
  }

  if (mode === 'record') return { findings: [] };
  return {
    ...(traffic ? { traffic } : {}), terminalPresent, completedEarly, requests: [...requests], apiNotReplayed: [...notReplayed], job, loading, blank, where, sessionCheck, screenshot,
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
    if (isBrowserCancelled(reason) || isIgnored(web.ignoreRequests, url)) return;
    report(requestProblem(request, reason, appOrigin));
  });
}

/**
 * The browser dropped the request itself (navigation, unmount, image swap): not a failure.
 * Exact texts only, so injected disconnects and real network errors stay reported.
 * Unrecorded API requests never reach this path; replay answers them with a 404.
 */
export const isBrowserCancelled = (errorText) => /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled|Load request cancelled)$/i.test(errorText);

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
