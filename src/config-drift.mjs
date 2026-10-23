import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { createFinding } from './findings.mjs';
import { discoverOptions, projectText } from './project-options.mjs';
import { discoverRoutes } from './route-discovery.mjs';

/** Setup's read-only inference on an exported tree: source syntax only, no installs or project code. */
export async function inferWebSettings(exportDir, workdir) {
  const [root, folder] = await Promise.all([realpath(exportDir), realpath(workdir)]);
  const files = (await readdir(folder, { recursive: true }))
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => !/(?:^|\/)(?:node_modules|\.git)(?:\/|$)/.test(file));
  const pkg = async (dir) => { try { return JSON.parse(await projectText(dir, 'package.json') || '{}'); } catch { return {}; } };
  const packages = folder === root ? [await pkg(folder)] : [await pkg(root), await pkg(folder)];
  const deps = Object.assign({}, ...packages.flatMap((item) => [item.dependencies, item.devDependencies]));
  const discovered = await discoverRoutes(folder, files, deps);
  const { web } = await discoverOptions(folder, files, discovered);
  return {
    colorSchemeStorage: web.colorSchemeStorage,
    routes: (web.routes ?? discovered.routes).filter((route) => !discovered.hashAliases.includes(route.path)),
    apiPaths: web.api?.paths ?? [],
  };
}

/**
 * Inferred web settings the loaded config lacks, one low finding per setting value.
 * A setting already configured, even differently, is left alone; routes match by path without query.
 */
export function compareWithInference(web, inferred) {
  const findings = [];
  const report = (setting, value, suggestion) => findings.push(createFinding({
    stage: 'config',
    check: 'setup-inference',
    severity: 'low',
    title: `config lacks inferred ${setting}${value ? ` ${value}` : ''}`,
    detail: `Setup inference on this commit suggests:\n${YAML.stringify({ web: suggestion }).trimEnd()}`,
    key: { setting, value: value ?? JSON.stringify(suggestion) },
  }));
  if (inferred.colorSchemeStorage && !web.colorSchemeStorage) report('web.colorSchemeStorage', null, { colorSchemeStorage: inferred.colorSchemeStorage });
  const routePath = (value) => value.replace(/^\//, '').split('?')[0];
  const configured = new Set(web.routes.map((route) => routePath(route.path)));
  for (const route of inferred.routes) if (!configured.has(routePath(route.path))) report('web.routes', route.path, { routes: [route] });
  for (const prefix of inferred.apiPaths) if (!web.api?.paths?.includes(prefix)) report('web.api.paths', prefix, { api: { paths: [prefix] } });
  return findings;
}

/**
 * Two colour schemes whose screenshots are byte-identical on every visit of a route
 * (same viewport and session) had no effect there, for example a theme kept in storage.
 */
export async function findIneffectiveSchemes(web, results) {
  const findings = [];
  for (const route of web.routes) {
    const visits = new Map();
    for (const { job, screenshot } of results) {
      if (job.route !== route || !screenshot) continue;
      const variant = `${job.target?.id ?? ''} ${job.viewport.width} ${job.session.name}`;
      if (!visits.has(variant)) visits.set(variant, {});
      visits.get(variant)[job.colorScheme] = await readFile(screenshot);
    }
    web.colorSchemes.forEach((first, index) => web.colorSchemes.slice(index + 1).forEach((second) => {
      const pairs = [...visits.values()].filter((shots) => shots[first] && shots[second]);
      if (!pairs.length || !pairs.every((shots) => shots[first].equals(shots[second]))) return;
      findings.push(createFinding({
        stage: 'web', check: 'color-scheme-no-effect', severity: 'low',
        title: `${first} and ${second} colour schemes render identically`,
        detail: `Every visit of this route produced byte-identical ${first} and ${second} screenshots. If the app keeps its theme in storage, set web.colorSchemeStorage.`,
        where: route.path,
        key: { route: route.path, schemes: [first, second] },
      }));
    }));
  }
  return findings;
}
