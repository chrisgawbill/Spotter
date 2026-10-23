import { openSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, realpath, stat, writeFile, lstat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { homedir, tmpdir } from 'node:os';
import { browseProjects, detectProject } from './project-setup.mjs';
import { listProjectNames, loadProjectConfig, normalizeConfig } from './config.mjs';
import { spotterHome, spotterRoot } from './paths.mjs';
import { summarizeCompleteness } from './completeness.mjs';
import { hasFailingFinding } from './findings.mjs';
import { resolvePlan, summarizePlan } from './levels.mjs';
import { configFields } from './config-fields.mjs';
import { retentionSettings, lockedRetention, loadSavedRetention, saveRetention, storageSummary, pruneProject } from './prune.mjs';

const guidedKeys = Object.keys(configFields).filter((key) => configFields[key].guided);

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const jsonFile = async (file) => readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const safeName = (name) => typeof name === 'string' && /^[A-Za-z0-9_-]+$/.test(name);
const runName = (name) => typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && !['.', '..', 'latest'].includes(name);

export async function branches(config) {
  const { stdout } = await exec('git', ['-C', config.repo, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  return stdout.trim().split('\n').filter((name) => name && !name.endsWith('/HEAD')).map((name) => name.replace(/^refs\/(heads|remotes)\//, ''));
}

async function readRun(home, project, id) {
  const directory = path.join(home, project, 'runs', id);
  const report = await jsonFile(path.join(directory, 'report.json'));
  const activity = await jsonFile(path.join(directory, 'activity.json'));
  if (!report && !activity) return null;
  const events = (await readFile(path.join(directory, 'activity.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  let status = report ? (report.completeness?.status === 'incomplete' ? 'incomplete' : hasFailingFinding(report.comparison.newFindings) ? 'fail' : 'pass') : activity.status;
  if (activity?.status === 'error' || (status === 'running' && Date.now() - Date.parse(activity.updatedAt) > 30_000)) status = 'error';
  const current = new Map();
  for (const event of events) {
    const key = `${event.side}:${event.activity}`;
    if (event.state === 'done') current.delete(key);
    else current.set(key, event);
  }
  return { id, project, branch: activity?.branch ?? report.head.label, status,
    startedAt: activity?.startedAt, updatedAt: activity?.updatedAt,
    error: activity?.error ?? (status === 'error' ? 'Runner heartbeat stopped. Inspect runner logs before restarting.' : null),
    current: status === 'running' ? [...current.values()] : [], events,
    report: report ? `/artifacts/${encodeURIComponent(project)}/${encodeURIComponent(id)}/report.html` : null,
    coverage: report?.completeness ? summarizeCompleteness(report.completeness) : null, gaps: report?.completeness?.gaps ?? [], notes: report?.completeness?.notes ?? [],
    plan: activity?.plan ?? report?.plan ?? null,
    checks: report?.head.stages };
}

/**
 * Whether the project needs fixtures recorded before a run: none yet, or its newest finished run
 * hit endpoints missing from them. Recording runs only in a server terminal, so this returns the
 * command to show, never runs it.
 */
export async function fixtureAdvice(home, config, branch) {
  if (!config.web?.api) return null;
  const recorded = await stat(path.join(home, config.name, 'fixtures', 'api.json')).then(() => true, () => false);
  let reason = recorded ? null : 'No API fixtures are recorded yet, so this run will be incomplete.';
  if (recorded) {
    const ids = (await readdir(path.join(home, config.name, 'runs'), { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && runName(entry.name)).map((entry) => entry.name).sort().reverse();
    for (const id of ids) {
      const report = await jsonFile(path.join(home, config.name, 'runs', id, 'report.json'));
      if (!report) continue;
      const { newFindings = [], existingFindings = [] } = report.comparison ?? {};
      if ([...newFindings, ...existingFindings].some((finding) => finding.check === 'unrecorded-request')) reason = `The last run (${report.head?.label ?? id}) called API endpoints the fixtures do not have.`;
      break;
    }
  }
  if (!reason) return null;
  const ref = /^[\w./@-]+$/.test(branch) ? branch : `'${branch.replace(/'/g, `'\\''`)}'`;
  return { reason, command: `bin/spotter record ${config.name} --ref ${ref}${recorded ? ' --merge' : ''}${config.web.api.backend ? ' --host-backend' : ''}` };
}

// ponytail: each download launches its own Chromium; a shared browser or a cache is the upgrade if downloads become frequent.
export async function renderReportPdf(file, root) {
  const { chromium } = await import('playwright'); // loaded on demand: Playwright exits at import on Node < 20
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
    const allowed = `${pathToFileURL(root).href}/`;
    await page.route('**/*', (route) => route.request().url().startsWith(allowed) ? route.continue() : route.abort());
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => Promise.all([...document.images].map((image) => { image.loading = 'eager'; return image.decode().catch(() => {}); })));
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally { await browser.close(); }
}

/** No shell is involved in run control. Only configured projects and listed branches are accepted. */
export function createDashboardServer({ home = spotterHome, projectNames = listProjectNames, loadConfig = loadProjectConfig, launch = spawn, branchRefreshMs = 60_000, projectsRoot = process.env.SPOTTER_PROJECTS_ROOT ?? path.join(homedir(), 'projects'), configsDir = path.join(spotterRoot, 'projects'), env = process.env, renderPdf = renderReportPdf } = {}) {
  let starting = false;
  let editing = false;
  const children = new Set();
  const fetchErrors = new Map();
  let fetching = false;
  async function refreshRemotes() {
    if (fetching) return;
    fetching = true;
    try {
      const repos = new Set();
      for (const name of (await projectNames()).filter(safeName)) {
        try { repos.add((await loadConfig(name)).repo); } catch { /* Invalid configs are reported by /api/projects. */ }
      }
      await Promise.all([...repos].map(async (repo) => {
        try {
          await exec('git', ['-C', repo, 'fetch', '--all', '--prune', '--no-tags'], {
            timeout: 45_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -oBatchMode=yes -oConnectTimeout=15' },
          });
          fetchErrors.delete(repo);
        } catch {
          fetchErrors.set(repo, 'Remote branch refresh failed. Showing cached branches; check repository access and Git credentials on the server.');
        }
      }));
    } finally { fetching = false; }
  }
  let refreshTimer;
  const projectFolders = (name) => ({ runs: path.join(home, name, 'runs'), baselines: path.join(home, name, 'baselines'), work: path.join(home, name, 'work') });

  const server = createServer(async (req, res) => {
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(type === 'application/json' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
    };
    try {
      const localHost = `${req.socket.localAddress}:${req.socket.localPort}`;
      const proxyHost = process.env.SPOTTER_TAILSCALE_IP ? `${process.env.SPOTTER_TAILSCALE_IP}:8088` : null;
      if (req.headers.host !== localHost && req.headers.host !== proxyHost) return send(403, { error: 'Unrecognized dashboard host' });
      const url = new URL(req.url, 'http://dashboard');
      if (url.pathname === '/api/project-folders' && req.method === 'GET') {
        return send(200, await browseProjects(projectsRoot, url.searchParams.get('folder') ?? undefined));
      }
      if (url.pathname === '/api/project-setup' && req.method === 'POST') {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Same-origin JSON required' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 4096) return send(413, { error: 'Request too large' });
        }
        const { folder, existingName } = JSON.parse(body);
        if (typeof folder !== 'string') return send(400, { error: 'Select a server folder' });
        return send(200, await detectProject(projectsRoot, folder, { configsDir, existingName }));
      }
      if (url.pathname === '/api/config-draft' && req.method === 'POST') {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Same-origin JSON required' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 262144) return send(413, { error: 'Request too large' });
        }
        const { source, fields } = JSON.parse(body);
        if (typeof source !== 'string') return send(400, { error: 'YAML source is required' });
        const document = YAML.parseDocument(source);
        if (document.errors.length) throw document.errors[0];
        if (!YAML.isMap(document.contents)) return send(400, { error: 'Config must be a YAML mapping' });
        if (fields) for (const key of guidedKeys) {
          if (typeof fields[key] !== 'string') return send(400, { error: `Invalid ${key}` });
          if (fields[key]) document.set(key, fields[key]);
          else document.delete(key);
        }
        return send(200, { source: document.toString(), fields: Object.fromEntries(guidedKeys.map((key) => [key, document.get(key) ?? ''])) });
      }
      const configRoute = /^\/api\/configs\/([^/]+)$/.exec(url.pathname);
      if (configRoute) {
        const name = decodeURIComponent(configRoute[1]);
        if (!safeName(name)) return send(400, { error: 'Use letters, numbers, underscores or hyphens for the project name' });
        const file = path.join(configsDir, `${name}.yml`);
        if (!['GET', 'PUT', 'DELETE'].includes(req.method)) return send(405, { error: 'Method not allowed' });
        if (req.method !== 'GET' && (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json')) return send(403, { error: 'Same-origin JSON required' });
        // Never follow config symlinks, including a dangling link on creation.
        const info = await lstat(file).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
        if (info && !info.isFile()) return send(400, { error: 'Config must be a regular file' });
        if (req.method === 'GET') return send(200, { source: await readFile(file, 'utf8') });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 262144) return send(413, { error: 'Config is too large (maximum 256 KB)' });
        }
        const input = JSON.parse(body);
        if (editing || starting || children.size) return send(409, { error: 'Wait for the active run or config change to finish' });
        editing = true;
        try {
          const current = await readFile(file, 'utf8').catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
          if (input.previous !== current) return send(409, { error: 'Config changed or already exists. Reopen it before saving or deleting.' });
          if (req.method === 'DELETE') {
            if (current === null) return send(404, { error: 'Config not found' });
            await unlink(file);
            return send(200, { deleted: name });
          }
          if (typeof input.source !== 'string') return send(400, { error: 'YAML source is required' });
          const parsed = YAML.parse(input.source);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send(400, { error: 'Config must be a YAML mapping' });
          normalizeConfig(parsed, { projectName: name, source: input.source });
          await mkdir(configsDir, { recursive: true });
          const temporary = path.join(configsDir, `.${name}-${randomUUID()}.tmp`);
          try {
            await writeFile(temporary, input.source, { flag: 'wx', mode: 0o600 });
            await rename(temporary, file);
          } finally { await unlink(temporary).catch(() => {}); }
          return send(200, { source: input.source });
        } finally { editing = false; }
      }
      if (req.method === 'POST' && url.pathname === '/api/runs') {
        // Same-origin JSON prevents a website outside the tailnet from triggering runs through a reviewer's browser.
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Same-origin JSON required' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return send(413, { error: 'Request too large' });
        }
        const { project, branch, level } = JSON.parse(body);
        const names = await projectNames();
        if (!safeName(project) || !names.includes(project)) return send(400, { error: 'Unknown project' });
        const config = await loadConfig(project);
        if (typeof branch !== 'string' || !(await branches(config)).includes(branch)) return send(400, { error: 'Select a listed branch' });
        if (level !== undefined && typeof level !== 'string') return send(400, { error: 'Level must be a string' });
        try { resolvePlan(config, level); } catch (error) { return send(400, { error: error.message }); }
        // Serialize dashboard runs; add a queue only if concurrent runs are needed.
        if (editing || starting || children.size) return send(409, { error: 'A dashboard run is already active' });
        starting = true;
        try {
          const id = `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${randomUUID()}`;
          const directory = path.join(home, project, 'runs', id);
          await mkdir(directory, { recursive: true });
          const now = new Date().toISOString();
          const metadata = { project, branch, status: 'running', level: level || null, startedAt: now, updatedAt: now };
          metadata.pid = process.pid;
          await writeFile(path.join(directory, 'activity.json'), JSON.stringify(metadata));
          const output = openSync(path.join(directory, 'runner.log'), 'a');
          // HOME may be the read-only SSH home used for fetches; runs need a writable one (Firefox profiles).
          const runHome = path.join(tmpdir(), 'home');
          await mkdir(runHome, { recursive: true });
          let child;
          try {
            child = launch(process.execPath, [path.join(spotterRoot, 'src/cli.mjs'), 'run', project, '--ref', branch, ...(level ? ['--level', level] : [])], {
              env: { ...process.env, HOME: runHome, SPOTTER_HOME: home, SPOTTER_RUN_ID: id }, stdio: ['ignore', output, output],
            });
          } finally { closeSync(output); }
          children.add(child);
          const finish = async (error) => {
            children.delete(child);
            if (!await jsonFile(path.join(directory, 'report.json'))) {
              const output = await readFile(path.join(directory, 'runner.log'), 'utf8').catch(() => '');
              await writeFile(path.join(directory, 'activity.json'), JSON.stringify({ ...metadata, status: 'error', error: output.slice(-2000) || error, updatedAt: new Date().toISOString() }));
            }
          };
          child.once('error', (error) => { void finish(error.message).catch(console.error); });
          child.once('exit', (code, signal) => { void finish(`Runner exited ${signal ?? code} before producing a report.`).catch(console.error); });
          return send(202, { project, id });
        } finally { starting = false; }
      }
      if (url.pathname === '/api/storage' && req.method === 'GET') {
        const settings = retentionSettings(env, {}, await loadSavedRetention(home));
        const projects = [];
        for (const name of (await projectNames()).filter(safeName)) projects.push({ name, ...await storageSummary(projectFolders(name), settings) });
        return send(200, { settings, locked: lockedRetention(env), projects });
      }
      if (url.pathname === '/api/retention' && req.method === 'PUT' || url.pathname === '/api/cleanup' && req.method === 'POST') {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Same-origin JSON required' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 4096) return send(413, { error: 'Request too large' });
        }
        if (url.pathname === '/api/retention') {
          await saveRetention(home, JSON.parse(body));
          return send(200, { settings: retentionSettings(env, {}, await loadSavedRetention(home)), locked: lockedRetention(env) });
        }
        if (starting) return send(409, { error: 'Wait for the run that is starting' });
        const settings = retentionSettings(env, {}, await loadSavedRetention(home));
        let removed = 0;
        const skipped = [];
        for (const name of (await projectNames()).filter(safeName)) {
          const result = await pruneProject(projectFolders(name), settings);
          removed += result.removed.length;
          if (result.skipped) skipped.push(name);
        }
        return send(200, { removed, skipped });
      }
      if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });
      if (url.pathname === '/api/projects') {
        const names = await projectNames();
        return send(200, await Promise.all(names.filter(safeName).map(async (name) => {
          try { const config = await loadConfig(name); return { name, branches: await branches(config), baseBranch: config.baseBranch, levels: { default: config.levels?.default ?? null, low: !!config.levels?.low }, error: fetchErrors.get(config.repo) }; }
          catch (error) { return { name, branches: [], error: error.message }; }
        })));
      }
      if (url.pathname === '/api/plan') {
        const project = url.searchParams.get('project');
        if (!safeName(project) || !(await projectNames()).includes(project)) return send(404, { error: 'Unknown project' });
        let plan;
        let config;
        try { config = await loadConfig(project); plan = resolvePlan(config, url.searchParams.get('level')); } catch (error) { return send(400, { error: error.message }); }
        const branch = url.searchParams.get('branch');
        return send(200, { level: plan.record?.name ?? null, source: plan.record?.source ?? null, summary: summarizePlan(plan), exclusions: plan.record?.exclusions ?? [], unsupported: plan.record?.unsupported ?? [],
          fixtures: branch ? await fixtureAdvice(home, { ...config, name: project }, branch) : null });
      }
      if (url.pathname === '/api/runs') {
        const runs = [];
        for (const project of (await projectNames()).filter(safeName)) {
          const ids = await readdir(path.join(home, project, 'runs'), { withFileTypes: true }).catch(() => []);
          for (const item of ids.filter((entry) => entry.isDirectory() && runName(entry.name)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 50)) {
            const run = await readRun(home, project, item.name);
            if (run) { const { events, ...summary } = run; runs.push(summary); }
          }
        }
        return send(200, runs.sort((a, b) => b.id.localeCompare(a.id)));
      }
      const activity = /^\/api\/runs\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (activity) {
        const [, project, id] = activity.map(decodeURIComponent);
        if (!safeName(project) || !runName(id) || !(await projectNames()).includes(project)) return send(404, { error: 'Run not found' });
        const run = await readRun(home, project, id);
        return send(run ? 200 : 404, run ?? { error: 'Run not found' });
      }
      if (url.pathname.startsWith('/artifacts/')) {
        const [, , project, id, ...parts] = url.pathname.split('/').map(decodeURIComponent);
        if (parts.at(-1) === '') parts.pop();
        if (!safeName(project) || !runName(id) || !(await projectNames()).includes(project) || parts.some((p) => !p || p === '..' || p === '.' || p.includes('/') || p.includes('\\'))) return send(404, { error: 'Artifact not found' });
        const root = await realpath(path.join(home, project, 'runs', id));
        const runsRoot = await realpath(path.join(home, project, 'runs'));
        if (!root.startsWith(`${runsRoot}${path.sep}`)) return send(404, { error: 'Artifact not found' });
        if (parts.length === 1 && parts[0] === 'report.pdf') {
          const html = await realpath(path.join(root, 'report.html')).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
          if (!html || !html.startsWith(`${root}${path.sep}`)) return send(404, { error: 'Artifact not found' });
          const pdf = await renderPdf(html, root);
          res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'");
          res.setHeader('Content-Disposition', `attachment; filename="spotter-${project}-${id}.pdf"`);
          return send(200, pdf, 'application/pdf');
        }
        const file = await realpath(path.join(root, ...parts));
        if (!file.startsWith(`${root}${path.sep}`)) return send(404, { error: 'Artifact not found' });
        if ((await stat(file)).isDirectory()) {
          if (!url.pathname.endsWith('/')) { res.writeHead(302, { Location: `${url.pathname}/` }); return res.end(); }
          const entries = await readdir(file);
          const links = entries.map((name) => {
            const label = name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
            return `<li><a href="${encodeURIComponent(name)}">${label}</a></li>`;
          }).join('');
          res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
          return send(200, `<!doctype html><title>Run artifacts</title><h1>Run artifacts</h1><ul>${links}</ul>`, 'text/html');
        }
        const ext = path.extname(file);
        const types = { '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain', '.log': 'text/plain' };
        if (!types[ext]) return send(404, { error: 'Artifact not found' });
        // Reports are untrusted artifacts; sandbox even when opened outside the iframe.
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'");
        const data = await readFile(file);
        // The embedded view has its own format tabs, so drop the report's Markdown · JSON · Logs links.
        if (url.searchParams.has('embed') && path.basename(file) === 'report.html') return send(200, data.toString().replace(/<p><a href="report\.md">Markdown<\/a>.*?<\/p>\n?/, ''), types[ext]);
        return send(200, data, types[ext]);
      }
      if (url.pathname === '/core.css') return send(200, await readFile(require.resolve('@chrisgawbill/aero-md3-core/core.css')), 'text/css');
      const assets = { '/': 'index.html', '/dashboard.js': 'dashboard.js', '/dashboard.css': 'dashboard.css', '/config-fields.mjs': '../config-fields.mjs' };
      if (assets[url.pathname]) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
        return send(200, await readFile(path.join(spotterRoot, 'src/dashboard', assets[url.pathname])), url.pathname === '/' ? 'text/html' : (/\.(js|mjs)$/.test(url.pathname)) ? 'text/javascript' : 'text/css');
      }
      send(404, { error: 'Not found' });
    } catch (error) {
      send(error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? 'Not found' : error.message });
    }
  });
  server.on('listening', () => {
    if (!branchRefreshMs) return;
    const refresh = () => { void refreshRemotes().catch(console.error); };
    refresh();
    refreshTimer = setInterval(refresh, branchRefreshMs);
    refreshTimer.unref();
  });
  server.on('close', () => clearInterval(refreshTimer));
  return server;
}

export async function startDashboard() {
  const host = process.env.SPOTTER_TAILSCALE_IP;
  const octets = host?.split('.').map(Number);
  if (!octets || octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255) || octets[0] !== 100 || octets[1] < 64 || octets[1] > 127) throw new Error('Set SPOTTER_TAILSCALE_IP to the server’s Tailscale IPv4 address (100.64.0.0/10).');
  const server = createDashboardServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8089, host, resolve); });
  console.error(`Spotter dashboard: http://${host}:8089`);
}
