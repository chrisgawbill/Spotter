import path from 'node:path';
import YAML from 'yaml';
import { projectText } from './project-options.mjs';

const q = (value) => /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
const dirOf = (file) => path.posix.dirname(file);
const under = (file, dir) => dir === '.' || file.startsWith(`${dir}/`);
const ancestors = (dir) => { const list = [dir]; while (list.at(-1) !== '.') list.push(dirOf(list.at(-1))); return list; };
const rel = (from, to) => path.posix.relative(from === '.' ? '' : from, to === '.' ? '' : to) || '.';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);
const SKIP = /(^|\/)(node_modules|dist|build|bin|obj|coverage|tests?|__tests__)\//;
const FRAMEWORKS = ['express', 'fastify', 'koa', '@hapi/hapi', 'hono', '@nestjs/core', 'restify', 'polka'];
const COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const SEEDS = ['seed', 'db:seed', 'reset', 'db:reset'];

function sameServer(a, b) {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    const port = (url) => url.port || (url.protocol === 'https:' ? '443' : '80');
    return x.protocol === y.protocol && port(x) === port(y) && (x.hostname === y.hostname || LOCAL.has(x.hostname) && LOCAL.has(y.hostname));
  } catch { return false; }
}

const json = async (repo, file) => { try { return JSON.parse(await projectText(repo, file)); } catch { return null; } };
const sources = async (repo, files, dir, ext) => {
  const texts = [];
  for (const file of files.filter((file) => under(file, dir) && ext.test(file) && !SKIP.test(file) && !/\.(test|spec)\./.test(file)).slice(0, 500)) texts.push(await projectText(repo, file));
  return texts;
};
const firstMatch = (texts, pattern) => { for (const text of texts) { const match = pattern.exec(text); if (match) return match[1]; } return null; };
const installFor = (files, dir) => {
  const has = (name) => files.includes(path.posix.join(dir, name));
  return has('package-lock.json') ? ['npm', 'npm ci'] : has('pnpm-lock.yaml') ? ['pnpm', 'pnpm install --frozen-lockfile'] : has('yarn.lock') ? ['yarn', 'yarn install --frozen-lockfile'] : ['npm', 'npm install'];
};

/** Proposes web.api.backend from repository files. Reads files and syntax only; never runs project code. */
export async function discoverBackend(repo, files, { recordFrom, name, workdir }) {
  const candidates = [];
  for (const file of files.filter((file) => file.endsWith('.csproj'))) {
    const dir = dirOf(file);
    const launch = path.posix.join(dir, 'Properties/launchSettings.json');
    if (!/<Project\s+Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/.test(await projectText(repo, file)) || !files.includes(launch)) continue;
    const settings = await json(repo, launch);
    let url;
    const entry = Object.entries(settings?.profiles ?? {}).find(([, profile]) => profile?.commandName === 'Project'
      && (url = String(profile.applicationUrl ?? '').split(';').find((part) => part.startsWith('http://'))));
    if (!entry) continue;
    const health = firstMatch(await sources(repo, files, dir, /\.cs$/), /\.Map(?:HealthChecks|Get)\(\s*"(\/(?:[\w-]+\/)*healthz?)"/);
    candidates.push({ kind: 'dotnet', file, dir, url: url.replace(/\/$/, ''), health, profileName: entry[0], env: entry[1].environmentVariables ?? {}, label: `${file} (.NET)` });
  }
  const own = workdir === '.' ? 'package.json' : `${workdir}/package.json`;
  for (const file of files.filter((file) => (file === 'package.json' || file.endsWith('/package.json')) && file !== own)) {
    const pkg = await json(repo, file);
    const script = pkg?.scripts?.start ? 'start' : pkg?.scripts?.dev ? 'dev' : null;
    const framework = FRAMEWORKS.find((dep) => pkg?.dependencies?.[dep] || pkg?.devDependencies?.[dep]);
    if (!script || !framework) continue;
    const dir = dirOf(file);
    const texts = await sources(repo, files, dir, /\.(js|mjs|cjs|ts|mts|cts)$/);
    const port = firstMatch(texts, /\.listen\(\s*(\d{2,5})\b/) ?? firstMatch(texts, /\bPORT\b[^\n;]*?(?:\|\||\?\?)\s*['"]?(\d{2,5})\b/);
    candidates.push({ kind: 'node', file, dir, script, url: port ? `http://localhost:${port}` : null,
      health: firstMatch(texts, /\.(?:get|all|head|route)\(\s*['"`](\/(?:[\w-]+\/)*healthz?)['"`]/), label: `${file} (Node ${framework})` });
  }
  if (!candidates.length) return { backend: null, evidence: null, notes: [] };
  const labels = candidates.map((c) => c.label).join(', ');
  if (!recordFrom) return { backend: null, evidence: null, notes: [`Backend candidates found (${labels}); set web.api.recordFrom to choose one.`] };
  const matches = candidates.filter((c) => c.url && sameServer(c.url, recordFrom));
  if (!matches.length) return { backend: null, evidence: null, notes: [`Backend candidates found (${labels}) but none serves ${recordFrom}; configure web.api.backend manually.`] };
  if (matches.length > 1) return { backend: null, evidence: null, notes: [`Several backends serve ${recordFrom} (${labels}); configure web.api.backend manually.`] };

  const [c] = matches;
  const notes = [];
  let compose = null;
  for (const dir of ancestors(c.dir)) {
    const file = COMPOSE.map((name) => path.posix.join(dir, name)).find((name) => files.includes(name));
    if (!file) continue;
    let services;
    try { services = YAML.parse(await projectText(repo, file))?.services; } catch { /* Reported below. */ }
    if (!services || typeof services !== 'object') notes.push(`Could not read ${file}; review whether the backend needs it.`);
    else if (Object.values(services).some((service) => service?.build)) notes.push(`${file} builds services; review whether the backend needs it.`);
    else compose = { file, dir, services: Object.keys(services) };
    break;
  }
  let ef = null;
  if (c.kind === 'dotnet') {
    find: for (const dir of ancestors(c.dir)) for (const manifest of [path.posix.join(dir, '.config/dotnet-tools.json'), path.posix.join(dir, 'dotnet-tools.json')]) {
      if (files.includes(manifest) && (await json(repo, manifest))?.tools?.['dotnet-ef']) { ef = { toolDir: dir, manifest }; break find; }
    }
    if (ef) {
      const migration = files.filter((file) => under(file, ef.toolDir) && /(^|\/)Migrations\/[^/]+\.cs$/.test(file)).sort()[0];
      ef.projectDir = migration && ancestors(dirOf(migration)).find((dir) => files.some((file) => dirOf(file) === dir && file.endsWith('.csproj'))) || c.dir;
      ef.env = Object.entries(c.env).filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && /^[\w.:/-]*$/.test(String(value))).map(([key, value]) => `${key}=${value} `).join('');
    }
  }
  const root = [c.dir, compose?.dir, ef?.toolDir].filter((dir) => dir !== undefined).sort((a, b) => a.length - b.length)[0];
  let seed = null;
  for (const file of files.filter((file) => under(file, root) && (file === 'package.json' || file.endsWith('/package.json'))).sort()) {
    const scripts = (await json(repo, file))?.scripts;
    const script = SEEDS.find((key) => typeof scripts?.[key] === 'string');
    if (script) { seed = { file, script, dir: dirOf(file) }; break; }
  }
  const seedCommand = (from) => { const [manager, install] = installFor(files, seed.dir); return `(cd ${q(from)} && ${install} && ${manager} run ${seed.script})`; };
  const parts = [];
  if (compose) parts.push(`docker compose -p spotter-${name} -f ${q(compose.file)} up -d --wait`);
  if (c.kind === 'dotnet') {
    if (ef) parts.push(`(cd ${q(ef.toolDir)} && dotnet tool restore && dotnet restore ${q(rel(ef.toolDir, c.dir))} && ${ef.env}dotnet ef database update --project ${q(rel(ef.toolDir, ef.projectDir))} --startup-project ${q(rel(ef.toolDir, c.dir))})`);
    if (seed) parts.push(seedCommand(seed.dir));
    parts.push(`exec dotnet run --project ${q(c.dir)} --launch-profile ${q(c.profileName)}`);
  } else {
    const [manager, install] = installFor(files, c.dir);
    // The shell is already in c.dir here, so another package's directory is made relative to it.
    if (c.dir !== '.') parts.push(`cd ${q(c.dir)}`);
    parts.push(install);
    if (seed) parts.push(seed.dir === c.dir ? `${manager} run ${seed.script}` : seedCommand(rel(c.dir, seed.dir)));
    parts.push(`exec ${manager} run ${c.script}`);
  }
  const backend = { run: parts.join(' && '), readyUrl: c.health ? c.url + c.health : c.url, timeoutMs: 300000 };
  if (compose) backend.stop = `docker compose -p spotter-${name} -f ${q(compose.file)} down -v`;
  const evidence = `backend inferred from ${c.file}${c.health ? ` with health route ${c.health}` : ''}${compose ? `, Compose services ${compose.services.join(', ')} from ${compose.file}` : ''}${ef ? `, EF migrations via ${ef.manifest}` : ''}${seed ? `, seed script ${seed.file} ${seed.script}` : ''}; review the command before recording`;
  const tools = [...c.kind === 'dotnet' ? ['.NET SDK'] : [], ...compose ? ['Docker Compose'] : []];
  if (tools.length) notes.push(`The proposed web.api.backend needs ${tools.join(' and ')} on this server; record with bin/spotter record ${name} --host-backend.`);
  if (!seed) notes.push('No seed or reset script found for the backend; recordings will reflect an empty database unless the backend seeds itself.');
  return { backend, evidence, notes };
}
