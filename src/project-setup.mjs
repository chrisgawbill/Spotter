import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import YAML from 'yaml';
import { discoverRoutes } from './route-discovery.mjs';
import { discoverOptions, projectText } from './project-options.mjs';
import { existingSettings, projectSettings, mergeSettings } from './setup-configs.mjs';
import { formatConfig } from './config-yaml.mjs';
import { configFields } from './config-fields.mjs';
import { spotterRoot } from './paths.mjs';
import { normalizeConfig, WEB_DEFAULTS } from './config.mjs';

const exec = promisify(execFile);
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage']);

// Resolve both paths so symlinks cannot browse outside the mounted projects tree.
export async function projectFolder(root, requested = root) {
  if (typeof requested !== 'string') throw new Error('Select a server folder');
  const base = await realpath(root);
  const folder = await realpath(requested);
  if ((folder !== base && !folder.startsWith(`${base}${path.sep}`)) || !(await stat(folder)).isDirectory()) throw new Error('Select a folder within the projects directory');
  return { base, folder };
}

export async function browseProjects(root, requested) {
  const { base, folder } = await projectFolder(root, requested);
  const entries = await readdir(folder, { withFileTypes: true });
  return { folder, parent: folder === base ? null : path.dirname(folder), folders: entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name))
    .map((entry) => ({ name: entry.name, path: path.join(folder, entry.name) })).sort((a, b) => a.name.localeCompare(b.name)) };
}

async function readPackage(root, folder, name = 'package.json') {
  const file = await realpath(path.join(folder, name));
  await projectFolder(root, path.dirname(file));
  if ((await stat(file)).size > 1_048_576) throw new Error(`${name} is too large`);
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function detectProject(root, requested, { configsDir = path.join(spotterRoot, 'projects'), existingName } = {}) {
  let { folder } = await projectFolder(root, requested);
  const selectionNotes = [];
  const entries = await readdir(folder, { withFileTypes: true });
  const rootPackage = entries.some((entry) => entry.name === 'package.json') ? await readPackage(root, folder) : null;
  if (!rootPackage || !['build', 'test', 'lint', 'typecheck', 'type-check'].some((name) => typeof rootPackage.scripts?.[name] === 'string')) {
    const apps = [];
    for (const entry of entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name))) {
      if (await stat(path.join(folder, entry.name, 'package.json')).then((info) => info.isFile()).catch(() => false)) apps.push(entry.name);
    }
    if (apps.length === 1) { folder = path.join(folder, apps[0]); selectionNotes.push(`Detected app subfolder: ${apps[0]}.`); }
    else if (apps.length > 1) selectionNotes.push(`Multiple app folders found: ${apps.join(', ')}. Open the desired app folder and generate again.`);
  }
  const git = async (...args) => (await exec('git', ['-C', folder, ...args], { timeout: 5000 })).stdout.trim();
  const repo = await git('rev-parse', '--show-toplevel');
  await projectFolder(root, repo);
  const notes = [...selectionNotes, 'Review generated commands before saving. Detection does not install dependencies or run project code.', 'Add project-specific rules, API recording settings and sign-in sessions as needed.'];
  let baseBranch = await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').catch(() => '');
  if (!baseBranch) {
    for (const branch of ['main', 'master']) {
      if (await git('show-ref', '--verify', `refs/heads/${branch}`).catch(() => '')) { baseBranch = branch; break; }
    }
  }
  if (!baseBranch) { baseBranch = await git('branch', '--show-current') || 'main'; notes.push('Confirm the base branch; no default branch was found.'); }
  let config = { repo, baseBranch, workdir: path.relative(repo, folder) || '.', checks: [] };
  const evidence = { repo: 'Git checkout', workdir: 'Selected app folder', baseBranch: 'Git default branch or local main/master' };
  const files = await readdir(folder);
  if (files.includes('package.json')) {
    const pkg = await readPackage(root, folder);
    const parentPkg = folder !== repo ? JSON.parse(await projectText(repo, 'package.json') || '{}') : {};
    const repoFiles = folder === repo ? files : await readdir(repo);
    const locks = new Set([...repoFiles, ...files]);
    const manager = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? parentPkg.packageManager ?? '')?.[1]
      ?? (locks.has('pnpm-lock.yaml') ? 'pnpm' : locks.has('yarn.lock') ? 'yarn' : [...locks].some((name) => ['bun.lock', 'bun.lockb'].includes(name)) ? 'bun' : 'npm');
    const locked = files.some((name) => ['package-lock.json', 'npm-shrinkwrap.json'].includes(name));
    config.install = manager === 'npm' ? (locked ? 'npm ci' : 'npm install')
      : manager === 'pnpm' ? `pnpm install${locks.has('pnpm-lock.yaml') ? ' --frozen-lockfile' : ''}`
      : manager === 'yarn' ? `yarn install${locks.has('yarn.lock') ? (/^yarn@1\./.test(pkg.packageManager ?? parentPkg.packageManager ?? '') || !locks.has('.yarnrc.yml') && !/yarn@[2-9]/.test(pkg.packageManager ?? parentPkg.packageManager ?? '') ? ' --frozen-lockfile' : ' --immutable') : ''}`
      : `bun install${[...locks].some((file) => /^bun\.lockb?$/.test(file)) ? ' --frozen-lockfile' : ''}`;
    if (manager === 'npm' && !locked && parentPkg.workspaces && repoFiles.includes('package-lock.json')) {
      const relative = path.relative(folder, repo).replace(/'/g, `'\\''`);
      config.install = `npm ci --prefix '${relative}'`;
    }
    evidence.install = 'Package manager declaration and available lockfile';
    const scripts = pkg.scripts ?? {};
    for (const name of ['typecheck', 'type-check', 'tsc', 'lint', 'lint:check', 'test', 'test:unit', 'format:check', 'check']) {
      if (typeof scripts[name] !== 'string') continue;
      if (/(?:^|\s)--(?:watch|fix|write)(?:\b|=)/.test(scripts[name])) { notes.push(`Skipped ${name}: script watches or modifies files.`); continue; }
      const command = scripts[name];
      const simple = !/[;&|]/.test(command);
      let run = `${manager} run ${name}`;
      let parser = 'generic';
      let args = '';
      if (simple && /\btsc\b/.test(command)) { parser = 'tsc'; args = `${/--noEmit|--build|(?:^|\s)-b(?:\s|$)/.test(command) ? '' : '--noEmit '}--pretty false`; }
      if (simple && /\bvitest\b/.test(command)) { parser = 'vitest'; args = `${/\brun\b/.test(command) ? '' : '--run '}--reporter=json --outputFile={output}`; }
      if (simple && /\bprettier\b/.test(command) && /--check/.test(command)) parser = 'prettier';
      if (args) run += manager === 'npm' ? ` -- ${args}` : ` ${args}`;
      if (/\breact-scripts\s+test\b/.test(command)) run = `CI=true ${run}`;
      config.checks.push({ name, run, parser, severity: name === 'format:check' ? 'low' : 'high', repro: `${manager} run ${name}` });
    }
    const deps = { ...parentPkg.dependencies, ...parentPkg.devDependencies, ...pkg.dependencies, ...pkg.devDependencies };
    if (!config.checks.some((check) => check.parser === 'tsc') && deps.typescript && files.includes('tsconfig.json')) {
      const execute = manager === 'npm' ? 'npx --no-install' : manager === 'yarn' ? 'yarn' : `${manager} exec`;
      config.checks.unshift({ name: 'typecheck', run: `${execute} tsc --noEmit --pretty false`, parser: 'tsc', severity: 'high' });
    }
    evidence.checks = 'package.json check scripts, known output parsers and TypeScript configuration';
    const sourceFiles = (await git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.')).split('\0').filter(Boolean);
    const discovered = await discoverRoutes(folder, sourceFiles, deps);
    notes.push(...discovered.notes);
    const options = await discoverOptions(folder, sourceFiles, discovered);
    Object.assign(evidence, options.evidence);
    notes.push(...options.notes);
    let buildScript = 'build';
    let output = deps['react-scripts'] ? 'build' : deps.next && discovered.staticExport ? 'out' : deps['@sveltejs/adapter-static'] ? 'build' : 'dist';
    let supported = deps.vite || deps['react-scripts'] || deps['@vue/cli-service'] || deps.astro && !discovered.serverBuild
      || deps.next && discovered.staticExport || deps['@sveltejs/adapter-static'];
    if (deps.next) supported = discovered.staticExport;
    if (deps['@sveltejs/kit']) supported = !!deps['@sveltejs/adapter-static'];
    if (deps.astro) supported = !discovered.serverBuild;
    if (deps.nuxt) supported = false;
    if (deps.nuxt && typeof scripts.generate === 'string') { buildScript = 'generate'; output = /^\D*2\./.test(deps.nuxt) ? 'dist' : '.output/public'; supported = true; }
    if (deps['@angular/core'] && files.includes('angular.json')) {
      const angular = await readPackage(root, folder, 'angular.json');
      const projects = Object.values(angular.projects ?? {});
      if (projects.length === 1) {
        const build = projects[0].architect?.build ?? projects[0].targets?.build;
        const options = build?.options ?? {};
        if (options.outputPath) {
          output = typeof options.outputPath === 'string' ? path.posix.join(options.outputPath, build.builder?.endsWith(':application') ? 'browser' : '')
            : path.posix.join(options.outputPath.base, options.outputPath.browser ?? 'browser');
          if (options.baseHref) discovered.base = options.baseHref;
          supported = true;
        }
      } else notes.push('Multiple Angular build targets found; select the app build and output directory manually.');
    }
    if (typeof scripts[buildScript] === 'string' && supported && !/\bvite\s+build\b[^;&]*--ssr/.test(scripts[buildScript])) {
      config.web = { ...WEB_DEFAULTS, faultInjection: { delayMs: 2000, timeoutMs: 5000, loadingSelector: '[aria-busy="true"], [role="progressbar"]' }, build: { run: `${manager} run ${buildScript}`, outDir: discovered.outDir ?? output }, base: discovered.base,
        routes: discovered.routes, viewports: [375, 1280], colorSchemes: ['light', 'dark'] };
      config.web = mergeSettings(config.web, options.web);
      evidence['web.build'] = 'Build script, frontend configuration and static output layout';
      evidence['web.base'] = 'Frontend build/router configuration (or / when unspecified)';
      evidence['web.routes'] ??= 'Frontend router definitions and file-based pages';
      notes.push('Review static build output and record API fixtures before running API-backed pages.');
    } else {
      notes.push('Browser checks were not generated: this build is unknown or needs a server. Configure a static export/build command and output directory.');
      notes.push(`Discovered route URLs: ${discovered.routes.map((route) => route.path).join(', ')}.`);
    }
  } else notes.push('No package.json in this folder. Select the app subfolder for script detection, or add install/check/build commands manually.');
  if (!config.checks.length) notes.push('No supported check scripts found; add checks manually.');
  let name = path.basename(repo).toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'my-app';
  const candidates = await existingSettings(configsDir, repo, folder);
  const portable = await projectSettings(repo, folder);
  if (portable) { config = mergeSettings(config, portable.config); notes.push(`Applied project-owned settings from ${portable.evidence}.`); }
  const selected = existingName ? candidates.find((candidate) => candidate.name === existingName) : candidates.length === 1 ? candidates[0] : null;
  if (existingName && !selected) throw new Error('Select a matching existing configuration');
  if (selected) { config = mergeSettings(config, selected.config); name = selected.name; notes.push(`Preserved all explicit settings from ${selected.name}; inferred values only fill gaps.`); }
  else if (candidates.length > 1) notes.push('Multiple existing configurations match this app. Choose one below to preserve its tuned settings.');
  const get = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
  const defaults = new Set(['web.viewports', 'web.colorSchemes', 'web.pageTimeoutMs', 'web.concurrency', 'web.accessibility', 'web.keyboard', 'web.settleMs', 'web.faultInjection', 'web.errorText', 'web.ignoreConsole', 'web.ignoreRequests']);
  const coverage = Object.keys(configFields).map((field) => {
    if (get(selected?.config, field) !== undefined) return { field, status: 'preserved', evidence: `Existing configuration: ${selected.name}` };
    if (get(portable?.config, field) !== undefined) return { field, status: 'detected', evidence: `Project configuration: ${portable.evidence}` };
    if (evidence[field]) return { field, status: /infer|assum/i.test(evidence[field]) ? 'inferred' : 'detected', evidence: evidence[field] };
    if (field.startsWith('web.') && config.web && defaults.has(field)) return { field, status: 'default', evidence: 'Spotter defaults; review for this project' };
    return { field, status: 'review', evidence: 'No unambiguous project setting found; review the dictionary guidance' };
  });
  normalizeConfig(config, { projectName: name });
  return { name, source: formatConfig(config, selected?.source), notes, coverage,
    existingConfigs: candidates.map((candidate) => candidate.name), existingName: selected?.name, previous: selected?.source };
}
