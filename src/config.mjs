import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { matrixProblems } from './browsers.mjs';
import { requirableNames } from './completeness.mjs';
import { FAULT_KINDS, levelProblems, normalizeLevels } from './levels.mjs';
import { normalizePerformance, performanceProblems } from './performance.mjs';
import { spotterRoot } from './paths.mjs';
import { readSessionState } from './sessions.mjs';

const projectsDir = path.join(spotterRoot, 'projects');

export const WEB_DEFAULTS = {
  viewports: [375, 1280],
  colorSchemes: ['light'],
  browsers: ['chromium'],
  devices: [],
  errorText: [],
  ignoreConsole: [],
  ignoreRequests: [],
  accessibility: true,
  keyboard: true,
  concurrency: 4,
  settleMs: 400,
  pageTimeoutMs: 30_000,
};

/** Names of the configured projects (one `projects/<name>.yml` each). */
export async function listProjectNames() {
  const files = await readdir(projectsDir).catch(() => []);
  return files.filter((file) => /\.ya?ml$/.test(file)).map((file) => file.replace(/\.ya?ml$/, ''));
}

/** Loads, validates and fills defaults for a project config. Throws a readable error on bad config. */
export async function loadProjectConfig(projectName, { includeSessions = true } = {}) {
  const file = path.join(projectsDir, `${projectName}.yml`);
  const source = await readFile(file, 'utf8').catch(() => {
    throw new Error(`No project config at projects/${projectName}.yml`);
  });
  const config = YAML.parse(source) ?? {};
  const normalized = normalizeConfig(config, { projectName, source });
  const hash = createHash('sha256').update(source);
  for (const session of normalized.web?.sessions ?? []) {
    if (includeSessions && session.storageState) hash.update(JSON.stringify(await readSessionState(session)));
  }
  normalized.configHash = hash.digest('hex').slice(0, 16);
  return normalized;
}

/** Validates a parsed config object and applies defaults (exported for tests). */
export function normalizeConfig(config, { projectName, source = '' }) {
  const problems = [];
  if (!config.repo || !path.isAbsolute(config.repo)) problems.push('`repo` must be an absolute path to a git checkout');
  for (const [index, check] of (config.checks ?? []).entries()) {
    if (!check.name || !check.run) problems.push(`checks[${index}] needs \`name\` and \`run\``);
  }
  if (config.web) {
    problems.push(...matrixProblems(config.web, 'web'));
    const specs = config.web.specs;
    if (specs?.mode !== undefined) problems.push('`web.specs.mode` is selected by --live-auth, not project configuration');
    if (specs !== undefined && (!specs || typeof specs !== 'object' || Array.isArray(specs)
      || !validSpecFiles(specs.files) || [specs.grep, specs.matrixGrep].some((grep) => grep !== undefined && typeof grep !== 'string'))) {
      problems.push('`web.specs` needs nonempty project-relative `files` and optional string `grep` and `matrixGrep`');
    }
    if (specs?.workers !== undefined && (!Number.isSafeInteger(specs.workers) || specs.workers < 1)) {
      problems.push('`web.specs.workers` must be a positive integer');
    }
    if (specs?.live !== undefined) {
      const live = specs.live;
      if (!live || !validSpecFiles(live.files) || !isHttpUrl(live.baseURL)
        || !Array.isArray(live.env) || live.env.some((name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
        problems.push('`web.specs.live` needs project-relative files, an http(s) baseURL and env variable names');
      }
    }
    if (!config.web.build?.run) problems.push('`web.build.run` is required when `web` is set');
    const sessions = config.web.sessions ?? [];
    if (!Array.isArray(sessions) || sessions.some((session) => !validSession(session))) {
      problems.push('`web.sessions` needs unique names, string localStorage entries and/or an absolute storageState file, and optional storageOrigin');
    } else {
      if (new Set(sessions.map((s) => s.name)).size !== sessions.length) problems.push('`web.sessions` names must be unique');
      if (sessions.some((session) => session.apiHeaders !== undefined && !validHeaders(session.apiHeaders))) problems.push(`\`web.sessions[].apiHeaders\` ${HEADERS_MESSAGE}`);
    }
    if (config.web.faultInjection) {
      if (typeof config.web.faultInjection !== 'object' || Array.isArray(config.web.faultInjection)) problems.push('`web.faultInjection` must be an object or false');
      const selector = config.web.faultInjection.loadingSelector;
      if (selector !== undefined && (typeof selector !== 'string' || !selector.trim())) problems.push('`web.faultInjection.loadingSelector` must be a nonempty selector');
      const kinds = config.web.faultInjection.kinds;
      if (kinds !== undefined && (!Array.isArray(kinds) || !kinds.length || new Set(kinds.map(String)).size !== kinds.length || kinds.some((kind) => !FAULT_KINDS.includes(String(kind))))) {
        problems.push(`\`web.faultInjection.kinds\` must list unique values from ${FAULT_KINDS.join(', ')}`);
      }
      const fault = config.web.faultInjection;
      if (fault.concurrency !== undefined && (!Number.isSafeInteger(fault.concurrency) || fault.concurrency < 1)) problems.push('`web.faultInjection.concurrency` must be a positive integer');
      if (fault.routes !== undefined && (!Array.isArray(fault.routes) || !fault.routes.length || new Set(fault.routes).size !== fault.routes.length || fault.routes.some((name) => !(config.web.routes ?? []).some((route) => (typeof route === 'string' ? route : route.name) === name)))) problems.push('`web.faultInjection.routes` must list unique configured route names');
      if (fault.terminalSelector !== undefined && (typeof fault.terminalSelector !== 'string' || !fault.terminalSelector.trim())) problems.push('`web.faultInjection.terminalSelector` must be a nonempty selector');
      if (fault.minObservationMs !== undefined && (!Number.isFinite(fault.minObservationMs) || fault.minObservationMs < 0 || fault.minObservationMs >= (fault.timeoutMs ?? 5000))) problems.push('`web.faultInjection.minObservationMs` must be nonnegative and below timeoutMs');
      if (fault.terminalSelector !== undefined && fault.minObservationMs === undefined) problems.push('`web.faultInjection.terminalSelector` requires minObservationMs covering the retry window');
      if (fault.minObservationMs !== undefined && fault.terminalSelector === undefined) problems.push('`web.faultInjection.minObservationMs` requires terminalSelector');
      for (const field of ['delayMs', 'timeoutMs']) {
        const value = config.web.faultInjection[field];
        if (value !== undefined && (!Number.isFinite(value) || value <= 0)) problems.push(`web.faultInjection.${field} must be positive`);
      }
    }
    problems.push(...performanceProblems(config.web));
    if (config.web.api !== undefined) problems.push(...apiProblems(config.web.api));
    if (!config.web.routes?.length) problems.push('`web.routes` needs at least one route');
  }
  const coverage = config.coverage;
  if (coverage !== undefined) {
    if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) problems.push('`coverage` must be an object');
    else {
      const names = requirableNames(config);
      if (coverage.required !== undefined && (!Array.isArray(coverage.required) || coverage.required.some((name) => typeof name !== 'string' || !names.includes(name)))) {
        problems.push('`coverage.required` must list configured checks, rules, web, specs, fixtures or session names');
      }
      if (coverage.minSpecs !== undefined && (!Number.isSafeInteger(coverage.minSpecs) || coverage.minSpecs < 1 || !config.web?.specs)) {
        problems.push('`coverage.minSpecs` must be a positive integer and requires `web.specs`');
      }
    }
  }
  problems.push(...levelProblems(config));
  if (problems.length) throw new Error(`Invalid projects/${projectName}.yml:\n- ${problems.join('\n- ')}`);

  return {
    name: projectName,
    repo: config.repo,
    baseBranch: config.baseBranch ?? 'main',
    workdir: config.workdir ?? '.',
    install: config.install ?? null,
    checks: (config.checks ?? []).map((check) => ({ parser: 'generic', severity: 'high', ...check })),
    rules: {
      forbiddenText: config.rules?.forbiddenText ?? [],
      importBoundaries: config.rules?.importBoundaries ?? [],
    },
    web: config.web ? normalizeWebConfig(config.web) : null,
    coverage: { required: coverage?.required ?? [], minSpecs: coverage?.minSpecs ?? null },
    levels: normalizeLevels(config.levels),
    configHash: createHash('sha1').update(source).digest('hex').slice(0, 10),
  };
}

function normalizeWebConfig(web) {
  return {
    ...WEB_DEFAULTS,
    ...web,
    sessions: [{ name: 'anonymous', localStorage: {} }, ...(web.sessions ?? [])],
    faultInjection: web.faultInjection === false ? null : { delayMs: 2000, timeoutMs: 5000, loadingSelector: '[aria-busy="true"], [role="progressbar"]', ...web.faultInjection, ...(Array.isArray(web.faultInjection?.kinds) ? { kinds: web.faultInjection.kinds.map(String) } : {}) },
    performance: normalizePerformance(web.performance),
    base: web.base ?? '/',
    build: { outDir: 'dist', env: {}, ...web.build },
    api: web.api ? {
      fakeOrigin: 'http://api.spotter.test', envVar: null, recordFrom: null, headers: {},
      ...web.api,
      paths: web.api.paths ?? [],
      expectedStatuses: (web.api.expectedStatuses ?? []).map(({ request, status }) => ({ request, status: [status].flat() })),
      backend: web.api.backend ? { timeoutMs: 60_000, stop: null, ...web.api.backend } : null,
    } : null,
    routes: web.routes.map((route) => (typeof route === 'string' ? { name: route, path: route } : route)),
  };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const API_PATH = /^\/[^\s?#*]*[^\s?#*/]$/;
const HEADERS_MESSAGE = 'must map header names to strings; use ${NAME} for environment values';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function validHeaders(map) {
  return isPlainObject(map) && Object.entries(map).every(([name, value]) =>
    HEADER_NAME.test(name) && typeof value === 'string' && !value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '').includes('${'));
}

function apiProblems(api) {
  if (!isPlainObject(api) || Object.keys(api).some((key) => !['envVar', 'paths', 'recordFrom', 'headers', 'backend', 'expectedStatuses', 'fakeOrigin'].includes(key))) {
    return ['`web.api` accepts envVar, paths, recordFrom, headers, backend and expectedStatuses'];
  }
  const problems = [];
  if (api.envVar === undefined && api.paths === undefined) problems.push('`web.api` needs `envVar` or `paths`');
  if (api.envVar !== undefined && (typeof api.envVar !== 'string' || !ENV_NAME.test(api.envVar))) problems.push('`web.api.envVar` must be an environment variable name');
  if (api.paths !== undefined && (!Array.isArray(api.paths) || !api.paths.length || new Set(api.paths).size !== api.paths.length
    || api.paths.some((item) => typeof item !== 'string' || !API_PATH.test(item)))) {
    problems.push('`web.api.paths` must list unique same-origin path prefixes such as /api (no trailing slash, query or wildcard)');
  }
  if (api.recordFrom !== undefined && !isHttpUrl(api.recordFrom)) problems.push('`web.api.recordFrom` must be an http(s) URL');
  if (api.headers !== undefined && !validHeaders(api.headers)) problems.push(`\`web.api.headers\` ${HEADERS_MESSAGE}`);
  if (api.expectedStatuses !== undefined && !Array.isArray(api.expectedStatuses)) problems.push('`web.api.expectedStatuses` must be a list of { request, status } entries');
  else for (const [index, entry] of (api.expectedStatuses ?? []).entries()) {
    if (!validExpectedStatus(entry)) problems.push(`\`web.api.expectedStatuses[${index}]\` needs \`request\` as "METHOD /path-regex" (for example "GET /api/items/\\d+") and \`status\` as an HTTP status from 400 to 599 or a list of them`);
  }
  const backend = api.backend;
  if (backend !== undefined && !(isPlainObject(backend) && Object.keys(backend).every((key) => ['run', 'readyUrl', 'timeoutMs', 'stop', 'seeded'].includes(key))
    && typeof backend.run === 'string' && backend.run.trim() && isHttpUrl(backend.readyUrl)
    && (backend.timeoutMs === undefined || (Number.isSafeInteger(backend.timeoutMs) && backend.timeoutMs > 0))
    && (backend.stop === undefined || (typeof backend.stop === 'string' && backend.stop.trim()))
    && (backend.seeded === undefined || typeof backend.seeded === 'boolean'))) {
    problems.push('`web.api.backend` needs a `run` command, an http(s) `readyUrl`, optional positive `timeoutMs`, optional `stop` command and optional boolean `seeded`');
  }
  return problems;
}

function validExpectedStatus(entry) {
  if (!isPlainObject(entry) || Object.keys(entry).some((key) => !['request', 'status'].includes(key))) return false;
  const match = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) (\/\S*)$/.exec(entry.request ?? '');
  try { if (!match) return false; new RegExp(match[2]); } catch { return false; }
  const statuses = [entry.status].flat();
  return statuses.length > 0 && statuses.every((status) => Number.isInteger(status) && status >= 400 && status <= 599);
}

function validSpecFiles(files) {
  return Array.isArray(files) && files.length > 0 && files.every((file) =>
    typeof file === 'string' && file.trim() && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'));
}

function validSession(session) {
  if (!session || typeof session.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(session.name)
    || session.name === 'anonymous' || Object.hasOwn(Object.prototype, session.name)) return false;
  if (session.localStorage === undefined && session.storageState === undefined) return false;
  if (session.localStorage !== undefined && (!session.localStorage || typeof session.localStorage !== 'object'
    || Array.isArray(session.localStorage) || Object.values(session.localStorage).some((value) => typeof value !== 'string'))) return false;
  if (session.storageState !== undefined && (typeof session.storageState !== 'string' || !path.isAbsolute(session.storageState))) return false;
  if (session.expectSelector !== undefined && (typeof session.expectSelector !== 'string' || !session.expectSelector.trim())) return false;
  return session.storageOrigin === undefined || isOrigin(session.storageOrigin);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return typeof value === 'string' && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function isOrigin(value) {
  return isHttpUrl(value) && new URL(value).origin === value;
}
