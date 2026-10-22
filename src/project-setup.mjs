import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import YAML from 'yaml';
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

async function readPackage(root, folder) {
  const file = await realpath(path.join(folder, 'package.json'));
  await projectFolder(root, path.dirname(file));
  if ((await stat(file)).size > 1_048_576) throw new Error('package.json is too large');
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
    if (typeof scripts.build === 'string' && (deps.vite || deps['react-scripts']) && !/\bvite\s+build\b[^;&]*--ssr/.test(scripts.build)) {
      config.web = { build: { run: `${manager} run build`, outDir: deps['react-scripts'] ? 'build' : 'dist' }, routes: [{ name: 'home', path: '/' }], viewports: [375, 1280], colorSchemes: ['light', 'dark'] };
      notes.push('Web defaults assume a static build: verify output directory, base path and routes (including hash routing). Record API fixtures before running API-backed pages.');
    } else notes.push('Browser checks were not generated: configure a static build command, output directory and routes for this app.');
  } else notes.push('No package.json in this folder. Select the app subfolder for script detection, or add install/check/build commands manually.');
  if (!config.checks.length) notes.push('No supported check scripts found; add checks manually.');
  const name = path.basename(repo).toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'my-app';
  normalizeConfig(config, { projectName: name });
  return { name, source: YAML.stringify(config), notes };
}
