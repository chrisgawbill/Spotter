import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createFinding } from './findings.mjs';

export const BUILD_METRICS = ['build.js', 'build.css', 'build.images', 'build.fonts', 'build.other', 'build.total'];
export const ROUTE_FIELDS = ['requests', 'apiRequests', 'bytes', 'imageBytes'];

const TEXT = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.txt', '.webmanifest', '.xml']);
const CATEGORIES = {
  js: ['.js', '.mjs'],
  css: ['.css'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico'],
  fonts: ['.woff', '.woff2', '.ttf', '.otf'],
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const isCount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const PERCENT = /^\d+(\.\d+)?%$/;

/** `<prefix>.<middle>.<last>` split on the first and last dot, or null. */
function splitMetric(metric, prefix) {
  const last = metric.lastIndexOf('.');
  if (!metric.startsWith(`${prefix}.`) || last <= prefix.length) return null;
  return { middle: metric.slice(prefix.length + 1, last), last: metric.slice(last + 1) };
}

function isMetricPattern(metric, rawWeb) {
  if (typeof metric !== 'string') return false;
  if (BUILD_METRICS.includes(metric)) return true;
  const routeNames = (Array.isArray(rawWeb.routes) ? rawWeb.routes : []).map((route) => (typeof route === 'string' ? route : route?.name));
  const route = splitMetric(metric, 'route');
  if (route) return ROUTE_FIELDS.includes(route.last) && (route.middle === '*' || routeNames.includes(route.middle));
  const timings = rawWeb.performance?.timings;
  const timing = splitMetric(metric, 'timing');
  if (timing) {
    const names = isObject(timings) && Array.isArray(timings.routes) ? timings.routes : [];
    return timing.last === 'load' && names.length > 0 && (timing.middle === '*' || names.includes(timing.middle));
  }
  return metric.startsWith('interaction.') && metric.length > 'interaction.'.length && isObject(timings) && timings.interactions !== undefined;
}

/** Problems with the raw `web.performance` block (string messages; [] when valid or absent). */
export function performanceProblems(rawWeb) {
  const performance = rawWeb?.performance;
  if (performance === undefined) return [];
  if (!isObject(performance) || !onlyKeys(performance, ['budgets', 'timings'])) return ['`web.performance` accepts budgets and timings'];
  const problems = [];
  const { budgets, timings } = performance;
  if (!Array.isArray(budgets) || !budgets.length) problems.push('`web.performance.budgets` must be a nonempty list');
  else {
    budgets.forEach((budget, index) => {
      const at = `web.performance.budgets[${index}]`;
      if (!isObject(budget) || !onlyKeys(budget, ['metric', 'max', 'maxIncrease', 'blocking'])) return problems.push(`\`${at}\` accepts metric, max, maxIncrease and blocking`);
      if (!isMetricPattern(budget.metric, rawWeb)) problems.push(`\`${at}.metric\` must be a build, route, timing or interaction metric of this project`);
      if (budget.max === undefined && budget.maxIncrease === undefined) problems.push(`\`${at}\` needs max or maxIncrease`);
      if (budget.max !== undefined && !isCount(budget.max)) problems.push(`\`${at}.max\` must be a nonnegative number`);
      const increase = budget.maxIncrease;
      if (increase !== undefined && !isCount(increase) && !(typeof increase === 'string' && PERCENT.test(increase))) problems.push(`\`${at}.maxIncrease\` must be a nonnegative number or a percent such as 10%`);
      if (budget.blocking !== undefined && typeof budget.blocking !== 'boolean') problems.push(`\`${at}.blocking\` must be true or false`);
    });
  }
  if (timings === undefined) return problems;
  if (!isObject(timings) || !onlyKeys(timings, ['samples', 'routes', 'interactions'])) return [...problems, '`web.performance.timings` accepts samples, routes and interactions'];
  if (timings.samples !== undefined && !(Number.isInteger(timings.samples) && timings.samples >= 3 && timings.samples <= 20)) problems.push('`web.performance.timings.samples` must be an integer from 3 to 20');
  const names = (Array.isArray(rawWeb.routes) ? rawWeb.routes : []).map((route) => (typeof route === 'string' ? route : route?.name));
  const routes = timings.routes;
  if (routes !== undefined && (!Array.isArray(routes) || new Set(routes).size !== routes.length || routes.some((name) => !names.includes(name)))) {
    problems.push('`web.performance.timings.routes` must list unique configured route names');
  }
  const interactions = timings.interactions;
  if (interactions !== undefined && (!isObject(interactions) || !onlyKeys(interactions, ['grep']) || typeof interactions.grep !== 'string' || !interactions.grep.trim() || !rawWeb.specs)) {
    problems.push('`web.performance.timings.interactions` needs a string grep and requires `web.specs`');
  }
  if (!(Array.isArray(routes) && routes.length) && interactions === undefined) problems.push('`web.performance.timings` needs routes or interactions');
  return problems;
}

/** Normalized `web.performance`: null when absent. */
export function normalizePerformance(raw) {
  if (!raw) return null;
  const increase = (value) => (value === undefined ? null : typeof value === 'string' ? { percent: parseFloat(value) } : { amount: value });
  const timings = raw.timings;
  return {
    budgets: raw.budgets.map((budget) => ({ metric: budget.metric, max: budget.max ?? null, maxIncrease: increase(budget.maxIncrease), blocking: budget.blocking ?? false })),
    timings: timings ? { samples: timings.samples ?? 5, routes: timings.routes ?? [], interactions: timings.interactions ? { grep: timings.interactions.grep } : null } : null,
  };
}

/** Gzip size of text files and raw size of the rest, per category, for every file under `outDir` except source maps. */
export async function measureBuild(outDir) {
  const totals = { js: 0, css: 0, images: 0, fonts: 0, other: 0 };
  const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const extension = extname(entry.name).toLowerCase();
    if (!entry.isFile() || extension === '.map') continue;
    const buffer = await readFile(join(entry.parentPath, entry.name));
    const size = TEXT.has(extension) ? gzipSync(buffer, { level: 9 }).length : buffer.length;
    const category = Object.keys(CATEGORIES).find((name) => CATEGORIES[name].includes(extension)) ?? 'other';
    totals[category] += size;
  }
  return {
    ...Object.fromEntries(Object.entries(totals).map(([name, size]) => [`build.${name}`, size])),
    'build.total': Object.values(totals).reduce((sum, size) => sum + size, 0),
  };
}

/** Metric map for one route from its visit counters. */
export function routeMetrics(routeName, counters) {
  return Object.fromEntries(ROUTE_FIELDS.map((field) => [`route.${routeName}.${field}`, counters[field]]));
}

const round = (value) => Math.round(value * 10) / 10;

/** Timing summary of samples in ms: median (mean of the middle two when even), min, max. */
export function aggregate(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { median: round(median), min: round(sorted[0]), max: round(sorted.at(-1)), samples };
}

/** Concrete metric names a budget applies to, among `names`. */
export function budgetMetrics(budget, names) {
  const wild = /^(route|timing)\.\*\.([^.]+)$/.exec(budget.metric);
  if (!wild) return names.filter((name) => name === budget.metric);
  return names.filter((name) => {
    const parts = splitMetric(name, wild[1]);
    return parts && parts.last === wild[2];
  });
}

export const isTiming = (metric) => metric.startsWith('timing.') || metric.startsWith('interaction.');
const formatBytes = (value) => (value < 1000 ? `${value} B` : `${(value / 1000).toFixed(1)} kB`);

/** A metric value with its unit: bytes as B/kB, timings as ms, counts plain. */
export function formatValue(metric, value) {
  if (isTiming(metric)) return `${value.toFixed(1)} ms`;
  if (/^build\.|\.(bytes|imageBytes)$/.test(metric)) return formatBytes(value);
  return String(value);
}

const valueOf = (measurements, metric) => measurements.resources?.[metric] ?? measurements.timings?.[metric]?.median;
const allNames = (measurements) => [...Object.keys(measurements.resources ?? {}), ...Object.keys(measurements.timings ?? {})];
const allowedValue = (base, increase) => (increase.percent !== undefined ? base * (1 + increase.percent / 100) : base + increase.amount);

function timingDetail(timing, environment) {
  const api = environment.api === 'replayed' ? 'API responses replayed — front-end timing, not backend performance' : 'API not used';
  return `median of ${timing.samples.length} samples (${timing.min.toFixed(1)}–${timing.max.toFixed(1)}); ${environment.browser}, ${environment.cpus} CPUs; ${api}`;
}

function budgetFinding({ budget, kind, metric, title, timing, environment, project }) {
  return createFinding({
    stage: 'web',
    check: 'performance-budget',
    severity: budget.blocking ? 'medium' : 'low',
    title,
    detail: timing ? timingDetail(timing, environment) : null,
    repro: timing ? `spotter run ${project} --level high` : null,
    key: { metric, budget: kind },
  });
}

/** One side's absolute (`max`) budget findings. Timings compare their median. */
export function absoluteBudgetFindings(performanceConfig, measurements, { project } = {}) {
  const findings = [];
  for (const budget of performanceConfig.budgets.filter((item) => item.max !== null)) {
    for (const metric of budgetMetrics(budget, allNames(measurements))) {
      const value = valueOf(measurements, metric);
      if (!(value > budget.max)) continue;
      findings.push(budgetFinding({
        budget, kind: 'max', metric, project,
        title: `performance budget exceeded: ${metric} is ${formatValue(metric, value)} (max ${formatValue(metric, budget.max)})`,
        timing: measurements.timings?.[metric], environment: measurements.environment,
      }));
    }
  }
  return findings;
}

/** True when a timing regression clears both the budget and the noise rule. */
export function timingIncreased(head, base, maxIncrease) {
  return head.median > allowedValue(base.median, maxIncrease) && head.min > base.max;
}

/** True when timing environments are equivalent. */
export function environmentsMatch(a, b) {
  return ['browser', 'cpus', 'api', 'samples'].every((key) => a?.[key] === b?.[key]);
}

/** Relative (`maxIncrease`) budget findings, head vs base, plus the metrics that could not be compared. */
export function relativeBudgetFindings(performanceConfig, head, base, { baseCached = false, project } = {}) {
  const findings = [];
  const notCompared = [];
  const sameEnvironment = Boolean(base) && Boolean(head.environment) && Boolean(base.environment) && environmentsMatch(head.environment, base.environment);
  for (const budget of performanceConfig.budgets.filter((item) => item.maxIncrease !== null)) {
    for (const metric of budgetMetrics(budget, allNames(head))) {
      const skip = (reason) => notCompared.push({ metric, reason });
      const timed = isTiming(metric);
      if (!base) { skip('no baseline'); continue; }
      if (timed && baseCached) { skip('cached base'); continue; }
      if ((timed ? base.timings?.[metric] : base.resources?.[metric]) === undefined) { skip('not measured on base'); continue; }
      if (timed && !sameEnvironment) { skip('different environment'); continue; }
      const headTiming = head.timings?.[metric];
      const baseValue = timed ? base.timings[metric].median : base.resources[metric];
      const headValue = timed ? headTiming.median : head.resources[metric];
      const exceeded = timed ? timingIncreased(headTiming, base.timings[metric], budget.maxIncrease) : headValue > allowedValue(baseValue, budget.maxIncrease);
      if (!exceeded) continue;
      const { percent, amount } = budget.maxIncrease;
      const allowed = percent !== undefined ? `+${percent}%` : `+${formatValue(metric, amount)}`;
      findings.push(budgetFinding({
        budget, kind: 'maxIncrease', metric, project,
        title: `performance regression: ${metric} rose from ${formatValue(metric, baseValue)} to ${formatValue(metric, headValue)} (allowed ${allowed})`,
        timing: headTiming, environment: head.environment,
      }));
    }
  }
  return { findings, notCompared };
}

/** One line for report.md `## Checks`. */
export function summarizePerformance(run) {
  const { budgets, head, base, notCompared = [] } = run.performance;
  if (!head) return 'performance: not measured';
  const metrics = allNames(head).length;
  const blocking = budgets.filter((budget) => budget.blocking).length;
  const parts = [`${metrics} metrics, ${budgets.length} budgets${blocking ? ` (${blocking} blocking)` : ''}`];
  if (head.timingError) parts.push(`timings failed: ${head.timingError}`);
  else if (head.timings) parts.push(`timings ${head.environment.samples} samples`);
  const gap = notCompared.find((item) => isTiming(item.metric));
  if (!base || notCompared.some((item) => item.reason === 'no baseline')) parts.push('not compared (no baseline)');
  else if (gap) parts.push(`timings not compared (${gap.reason})`);
  else if (notCompared.length) parts.push(`${notCompared.length} metrics not on base`);
  else parts.push('compared with base');
  return `performance: ${parts.join(' · ')}`;
}

/** Timing turn-taking across the two sides of one run. */
export function createTimingGate(parties) {
  let settled = 0;
  let release;
  const everyone = new Promise((resolve) => { release = resolve; });
  let lock = Promise.resolve();
  return {
    side() {
      let counted = false;
      const settle = () => {
        if (counted) return;
        counted = true;
        if (++settled >= parties) release();
      };
      return {
        arrive() { settle(); return everyone; },
        turn(fn) {
          const result = lock.then(fn);
          lock = result.catch(() => {});
          return result;
        },
        done: settle,
      };
    },
  };
}
