import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import YAML from 'yaml';
import { discoverRoutes } from './route-discovery.mjs';
import { normalizeConfig } from './config.mjs';

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

export async function detectProject(root, requested) {
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
  const config = { repo, baseBranch, workdir: path.relative(repo, folder) || '.', checks: [] };
  const files = await readdir(folder);
  if (files.includes('package.json')) {
    const pkg = await readPackage(root, folder);
    const manager = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? '')?.[1]
      ?? (files.includes('pnpm-lock.yaml') ? 'pnpm' : files.includes('yarn.lock') ? 'yarn' : files.some((name) => ['bun.lock', 'bun.lockb'].includes(name)) ? 'bun' : 'npm');
    const locked = files.some((name) => ['package-lock.json', 'npm-shrinkwrap.json'].includes(name));
    config.install = manager === 'npm' ? (locked ? 'npm ci' : 'npm install') : `${manager} install`;
    const scripts = pkg.scripts ?? {};
    for (const name of ['typecheck', 'type-check', 'lint', 'test', 'format:check']) {
      if (typeof scripts[name] !== 'string') continue;
      if (/(?:^|\s)--(?:watch|fix|write)(?:\b|=)/.test(scripts[name])) { notes.push(`Skipped ${name}: script watches or modifies files.`); continue; }
      let run = `${manager} run ${name}`;
      if (name === 'test' && /\bvitest\b/.test(scripts[name]) && !/\brun\b/.test(scripts[name])) run += manager === 'npm' ? ' -- --run' : ' --run';
      if (name === 'test' && /\breact-scripts\s+test\b/.test(scripts[name])) run = `CI=true ${run}`;
      config.checks.push({ name, run, parser: 'generic', severity: name === 'format:check' ? 'low' : 'high' });
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const sourceFiles = (await git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.')).split('\0').filter(Boolean);
    const discovered = await discoverRoutes(folder, sourceFiles, deps);
    notes.push(...discovered.notes);
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
      config.web = { build: { run: `${manager} run ${buildScript}`, outDir: discovered.outDir ?? output }, base: discovered.base,
        routes: discovered.routes, viewports: [375, 1280], colorSchemes: ['light', 'dark'] };
      notes.push('Review static build output and record API fixtures before running API-backed pages.');
    } else {
      notes.push('Browser checks were not generated: this build is unknown or needs a server. Configure a static export/build command and output directory.');
      notes.push(`Discovered route URLs: ${discovered.routes.map((route) => route.path).join(', ')}.`);
    }
  } else notes.push('No package.json in this folder. Select the app subfolder for script detection, or add install/check/build commands manually.');
  if (!config.checks.length) notes.push('No supported check scripts found; add checks manually.');
  const name = path.basename(repo).toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'my-app';
  normalizeConfig(config, { projectName: name });
  return { name, source: YAML.stringify(config), notes };
}
