import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { spotterRoot } from './paths.mjs';

const projectsDir = path.join(spotterRoot, 'projects');

const WEB_DEFAULTS = {
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
export async function loadProjectConfig(projectName) {
  const file = path.join(projectsDir, `${projectName}.yml`);
  const source = await readFile(file, 'utf8').catch(() => {
    throw new Error(`No project config at projects/${projectName}.yml`);
  });
  const config = YAML.parse(source) ?? {};
  return normalizeConfig(config, { projectName, source });
}

/** Validates a parsed config object and applies defaults (exported for tests). */
export function normalizeConfig(config, { projectName, source = '' }) {
  const problems = [];
  if (!config.repo || !path.isAbsolute(config.repo)) problems.push('`repo` must be an absolute path to a git checkout');
  for (const [index, check] of (config.checks ?? []).entries()) {
    if (!check.name || !check.run) problems.push(`checks[${index}] needs \`name\` and \`run\``);
  }
  if (config.web) {
    if (!config.web.build?.run) problems.push('`web.build.run` is required when `web` is set');
    const sessions = config.web.sessions ?? [];
    if (!Array.isArray(sessions) || sessions.some((s) => !s || typeof s.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(s.name) || s.name === 'anonymous' || Object.hasOwn(Object.prototype, s.name) || !s.localStorage || typeof s.localStorage !== 'object' || Array.isArray(s.localStorage) || Object.values(s.localStorage).some((v) => typeof v !== 'string'))) problems.push('`web.sessions` needs unique names and string localStorage entries');
    else if (new Set(sessions.map((s) => s.name)).size !== sessions.length) problems.push('`web.sessions` names must be unique');
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
