import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { requirableNames } from './completeness.mjs';
import { levelProblems, normalizeLevels } from './levels.mjs';
import { spotterRoot } from './paths.mjs';
import { readSessionState } from './sessions.mjs';

const projectsDir = path.join(spotterRoot, 'projects');

export const WEB_DEFAULTS = {
  viewports: [375, 1280],
  colorSchemes: ['light'],
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
    const specs = config.web.specs;
    if (specs?.mode !== undefined) problems.push('`web.specs.mode` is selected by --live-auth, not project configuration');
    if (specs !== undefined && (!specs || typeof specs !== 'object' || Array.isArray(specs)
      || !validSpecFiles(specs.files) || (specs.grep !== undefined && typeof specs.grep !== 'string'))) {
      problems.push('`web.specs` needs nonempty project-relative `files` and optional string `grep`');
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
    } else if (new Set(sessions.map((s) => s.name)).size !== sessions.length) problems.push('`web.sessions` names must be unique');
    if (config.web.faultInjection) {
      if (typeof config.web.faultInjection !== 'object' || Array.isArray(config.web.faultInjection)) problems.push('`web.faultInjection` must be an object or false');
      const selector = config.web.faultInjection.loadingSelector;
      if (selector !== undefined && (typeof selector !== 'string' || !selector.trim())) problems.push('`web.faultInjection.loadingSelector` must be a nonempty selector');
      for (const field of ['delayMs', 'timeoutMs']) {
        const value = config.web.faultInjection[field];
        if (value !== undefined && (!Number.isFinite(value) || value <= 0)) problems.push(`web.faultInjection.${field} must be positive`);
      }
    }
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
    faultInjection: web.faultInjection === false ? null : { delayMs: 2000, timeoutMs: 5000, loadingSelector: '[aria-busy="true"], [role="progressbar"]', ...web.faultInjection },
    base: web.base ?? '/',
    build: { outDir: 'dist', env: {}, ...web.build },
    api: web.api ? { fakeOrigin: 'http://api.spotter.test', ...web.api } : null,
    routes: web.routes.map((route) => (typeof route === 'string' ? { name: route, path: route } : route)),
  };
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
