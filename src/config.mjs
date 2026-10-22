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
    base: web.base ?? '/',
    build: { outDir: 'dist', env: {}, ...web.build },
    api: web.api ? { fakeOrigin: 'http://api.spotter.test', ...web.api } : null,
    routes: web.routes.map((route) => (typeof route === 'string' ? { name: route, path: route } : route)),
  };
}
