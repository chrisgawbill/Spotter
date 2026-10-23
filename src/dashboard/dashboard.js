import { configFields } from '/config-fields.mjs';
const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const statuses = { pass: ['success', '✓'], fail: ['danger', '✕'], running: ['primary', '●'], error: ['warning', '!'], incomplete: ['warning', '◐'] };
const badge = (status) => {
  const [tone, icon] = statuses[status] ?? ['danger', '!'];
  return `<span class="ds-chip ds-chip-${tone} status status-${escape(status)}"><span aria-hidden="true">${icon}</span>${escape(status.toUpperCase())}</span>`;
};
const link = (run) => `#run/${encodeURIComponent(run.project)}/${encodeURIComponent(run.id)}`;
const time = (at) => at ? new Date(at).toLocaleString() : 'Not recorded';
const labels = { export: 'Export', 'static checks': 'Static checks', rules: 'Rules', 'web build': 'Build', 'web sweep': 'Browser sweep', 'project specs': 'Project specs', 'live authentication specs': 'Live authentication', 'compare findings and screenshots': 'Compare with base', 'reusing cached results': 'Reused cached results' };
const duration = (ms) => { const s = Math.round(ms / 1000); return Number.isFinite(s) ? (s < 60 ? `${Math.max(0, s)}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`) : ''; };
const marks = { done: ['✓', 'Done'], running: ['●', 'In progress'], stopped: ['✕', 'Did not finish'] };
const mark = (state) => `<span class="mark mark-${state}" aria-hidden="true">${marks[state][0]}</span><span class="ds-visually-hidden">${marks[state][1]}: </span>`;
// Group one side's runner events into checklist sections; checks and browser routes become sub-items.
function sections(events, side) {
  const list = new Map();
  for (const e of events.filter((e) => e.side === side || (side === 'head' && e.side === 'run'))) {
    const at = Date.parse(e.at);
    const [key, child] = e.activity.startsWith('check: ') ? ['static checks', e.activity.slice(7)]
      : e.activity === 'dependency install' ? ['static checks', 'install']
      : e.activity === 'web build' ? ['web sweep', 'build']
      : e.activity.startsWith('browser: ') ? ['web sweep', e.activity.slice(9).split(' [')[0]]
      : [e.activity.startsWith('web sweep') ? 'web sweep' : e.activity, null];
    if (!list.has(key)) list.set(key, { label: labels[key] ?? key.replace(/^./, (c) => c.toUpperCase()), start: at, children: new Map() });
    const section = list.get(key);
    if (!child) {
      if (key === 'web sweep') section.total = Number(/\((\d+) routes/.exec(e.activity)?.[1]) || 0;
      if (e.state === 'done') section.end = at;
      continue;
    }
    if (!section.children.has(child)) section.children.set(child, new Set());
    if (e.state === 'done') section.children.get(child).delete(e.activity); else section.children.get(child).add(e.activity);
  }
  return list;
}
// A route counts as checked while none of its visits are open; it can briefly reopen when its next visit starts.
const checked = (section) => [...section.children].filter(([name, open]) => name !== 'build' && !open.size).length;
function checklist(run, steps) {
  const running = run.status === 'running';
  const finished = Date.parse(run.updatedAt);
  return [...steps.values()].map((s) => {
    const state = s.end ? 'done' : running ? 'running' : 'stopped';
    const items = [...s.children].map(([name, open]) => { const item = !open.size ? 'done' : running ? 'running' : 'stopped'; return `<li>${mark(item)}<span>${escape(name)}</span></li>`; }).join('');
    const count = s.total ? ` <span class="muted">${checked(s)}/${s.total}</span>` : '';
    return `<li class="step-${state}">${mark(state)}<span>${escape(s.label)}${count}</span><time>${duration((s.end ?? (running ? Date.now() : finished)) - s.start)}</time>${items ? `<ol>${items}</ol>` : ''}</li>`;
  }).join('') || `<li class="muted">${running ? 'Waiting for the runner…' : 'No step history recorded for this run.'}</li>`;
}
function now(run, steps) {
  const base = sections(run.events, 'base');
  const baseOpen = [...base.values()].filter((s) => !s.end).at(-1);
  const baseText = base.has('reusing cached results') ? '✓ Reused cached results' : baseOpen && run.status === 'running' ? `● ${escape(baseOpen.label)}` : base.size ? '✓ Finished' : 'Waiting';
  if (run.status !== 'running') return `<p class="muted">${run.status === 'error' ? 'Stopped before completing.' : `Finished${run.startedAt ? ` in ${duration(Date.parse(run.updatedAt) - Date.parse(run.startedAt))}` : ''}.`} Merge base: ${baseText}</p>`;
  const current = [...steps.values()].filter((s) => !s.end).at(-1);
  const sweep = steps.get('web sweep');
  const visit = run.current.filter((e) => e.side === 'head' && e.activity.startsWith('browser: ')).at(-1)?.activity.slice(9);
  const progress = sweep && !sweep.end && sweep.total ? `<progress max="${sweep.total}" value="${checked(sweep)}" aria-label="Routes checked"></progress><p>${checked(sweep)} / ${sweep.total} routes checked${visit ? ` · <span class="muted">${escape(visit)}</span>` : ''}</p>` : '';
  return `${current ? `<p class="muted">Running for ${duration(Date.now() - current.start)}</p>` : ''}${progress}<p class="muted">Merge base: ${baseText}</p>`;
}
// Preserve keyboard focus and avoid announcing unchanged activity on every poll.
function html(id, content) {
  const element = $(id);
  if (element.innerHTML === content) return;
  const href = element.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
  element.innerHTML = content;
  if (href) [...element.querySelectorAll('a')].find((a) => a.getAttribute('href') === href)?.focus({ preventScroll: true });
}
let projects = [];
let selected = '';
let refreshing = false;
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}
function showError(error) { $('error').textContent = error?.message ?? ''; $('error').hidden = !error; }
function updateBranches(previousBranch = '') {
  const project = projects.find((p) => p.name === $('project').value);
  html('branch', (project?.branches ?? []).map((b) => `<option>${escape(b)}</option>`).join(''));
  if (project?.branches.includes(previousBranch)) $('branch').value = previousBranch;
  else if (project?.branches.includes(project.baseBranch)) $('branch').value = project.baseBranch;
  $('project-info').textContent = project?.error ?? (project ? `Compare against ${project.baseBranch ?? 'main'}. Runs use recorded API fixtures.` : 'Add a project configuration to start a run.');
  const levels = project?.levels;
  $('level').options[0].textContent = `Project default (${levels?.default ?? 'none'})`;
  $('level').options[1].disabled = !levels?.low;
  if ($('level').value === 'low' && !levels?.low) $('level').value = '';
  void updatePlan();
  $('submit').disabled = !$('branch').value || planFailed;
}
// Show what the chosen level will run; a level the project cannot run blocks the start button.
let planKey = '';
let planFailed = false;
async function updatePlan() {
  const key = `${$('project').value}\n${$('level').value}\n${$('branch').value}`;
  if (!$('project').value || key === planKey) return;
  planKey = key;
  try {
    const plan = await api(`/api/plan?project=${encodeURIComponent($('project').value)}&level=${encodeURIComponent($('level').value)}&branch=${encodeURIComponent($('branch').value)}`);
    if (key !== planKey) return;
    $('plan').textContent = `Plan: ${plan.summary}`;
    $('record-help').hidden = !plan.fixtures;
    $('record-reason').textContent = plan.fixtures?.reason ?? '';
    $('record-command').textContent = plan.fixtures?.command ?? '';
    $('record-message').textContent = '';
    planFailed = false;
  } catch (error) {
    if (key !== planKey) return;
    $('plan').textContent = error.message;
    $('record-help').hidden = true;
    planFailed = true;
  }
  $('submit').disabled = !$('branch').value || planFailed;
}
$('project').addEventListener('change', () => updateBranches());
$('level').addEventListener('change', () => void updatePlan());
$('branch').addEventListener('change', () => void updatePlan());
$('copy-record').addEventListener('click', async () => {
  try {
    await copyText($('record-command').textContent);
    $('record-message').textContent = 'Copied.';
  } catch (error) { $('record-message').textContent = `Could not copy: ${error.message}`; }
});
$('start').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('submit').disabled = true;
  showError(null);
  try {
    const run = await api('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: $('project').value, branch: $('branch').value, ...($('level').value && { level: $('level').value }) }) });
    location.hash = link(run);
    await refresh();
    $('detail-title').focus();
  } catch (error) { showError(error); }
  finally { $('submit').disabled = !$('branch').value || planFailed; }
});
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const current = location.hash === '#configs' ? 'configs' : location.hash === '#storage' ? 'storage' : 'runs';
    const [title, description] = { runs: ['See what changed.', 'Start a check, follow the work, and review what Spotter found.'], configs: ['Configure your checks.', 'Build a project configuration with field guidance and examples.'], storage: ['Keep disk use in check.', 'See what Spotter stores and choose how much history to keep.'] }[current];
    $('page-title').textContent = title;
    $('page-description').textContent = description;
    $('run-page').hidden = current !== 'runs';
    $('config-page').hidden = current !== 'configs';
    $('storage-page').hidden = current !== 'storage';
    for (const a of document.querySelectorAll('nav a.nav-link')) {
      if (a.getAttribute('href') === { runs: '#', configs: '#configs', storage: '#storage' }[current]) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    const previousProject = $('project').value;
    const previousBranch = $('branch').value;
    const [nextProjects, runs] = await Promise.all([api('/api/projects'), api('/api/runs')]);
    projects = nextProjects;
    html('config-list', projects.map((p) => `<article class="config-card ds-card ds-aero-surface ds-stack"><h3>${escape(p.name)}</h3><button class="ds-button button-secondary" type="button" data-config="${escape(p.name)}">Edit configuration</button></article>`).join('') || '<p class="empty-state">No configurations yet. Use Set up from folder or New configuration to add one.</p>');
    html('project', projects.map((p) => `<option>${escape(p.name)}</option>`).join(''));
    if (projects.some((p) => p.name === previousProject)) $('project').value = previousProject;
    updateBranches($('project').value === previousProject ? previousBranch : '');
    html('runs', runs.map((run) => {
      const text = escape(run.current.at(-1)?.activity ?? (run.report ? 'Report ready' : run.error ?? 'Preparing'));
      return `<tr><td><strong>${escape(run.project)}</strong><br><span class="branch">${escape(run.branch)}</span></td><td>${badge(run.status)}</td><td><span class="activity-text" title="${text}">${text}</span></td><td><a href="${link(run)}">${run.status === 'running' ? 'Follow activity' : 'View run'} →</a><br><small>${escape(time(run.startedAt))}</small></td></tr>`;
    }).join(''));
    $('empty').hidden = runs.length > 0;
    html('projects', projects.map((project) => {
      const latest = runs.find((run) => run.project === project.name);
      return `<article class="project-card ds-card ds-aero-surface ds-stack"><h3>${escape(project.name)}</h3>${latest ? `${badge(latest.status)}<p class="branch">${escape(latest.branch)}</p><a href="${link(latest)}">Open latest run →</a>` : '<p class="muted">No runs yet</p>'}</article>`;
    }).join('') || '<p class="empty-state">No projects configured yet. <a href="#configs">Add a configuration</a> to start running checks.</p>');
    $('synced').textContent = `Refreshed ${new Date().toLocaleTimeString()} · every 2s`;
    $('synced').classList.remove('is-paused');
    const match = /^#run\/([^/]+)\/([^/]+)$/.exec(location.hash);
    $('detail').hidden = !match;
    if (match) {
      const key = `${match[1]}/${match[2]}`;
      const run = await api(`/api/runs/${key}`);
      $('identity').textContent = `${run.project} / ${run.branch} · ${run.id}`;
      $('run-plan').textContent = run.plan ? `Plan: ${run.plan}` : '';
      $('run-plan').hidden = !run.plan;
      html('status', badge(run.status));
      $('updated').textContent = `Last runner update: ${time(run.updatedAt)} · Checked ${new Date().toLocaleTimeString()}`;
      html('current', run.current.map((e) => `<li><span class="side">${escape(e.side)}</span> ${escape(e.activity)}</li>`).join('') || (run.status === 'running' ? '' : '<li>Run finished</li>'));
      $('run-error').textContent = run.error ?? '';
      $('coverage').textContent = run.coverage ?? '';
      $('coverage').hidden = !run.coverage;
      html('coverage-gaps', (run.gaps ?? []).map((gap) => `<li>${escape(gap)}</li>`).join(''));
      const steps = sections(run.events, 'head');
      const active = [...steps.values()].filter((s) => !s.end).at(-1);
      html('now-step', run.status === 'running' ? (active ? `${mark('running')}${escape(active.label)}` : 'Preparing run…') : badge(run.status));
      html('now-detail', now(run, steps));
      html('checklist', checklist(run, steps));
      $('current').parentElement.hidden = run.status !== 'running';
      const history = $('events');
      const atBottom = history.scrollTop + history.clientHeight >= history.scrollHeight - 30;
      html('events', run.events.map((e) => `<li><time>${escape(time(e.at))}</time> <span class="side">${escape(e.side)}</span> ${e.state === 'done' ? '✓ Completed' : '→ Started'} ${escape(e.activity)}</li>`).join('') || '<li>Preparing run…</li>');
      if (atBottom) history.scrollTop = history.scrollHeight;
      $('report-section').hidden = !run.report;
      if (run.report && $('report').dataset.report !== run.report) {
        $('report').dataset.report = run.report;
        $('report').src = `${run.report}?embed`;
        void showFormat(format);
      }
      if (key !== selected) { $('detail').scrollIntoView({ block: 'start' }); selected = key; }
    } else selected = '';
  } catch (error) { $('synced').textContent = `Updates paused: ${error.message}`; $('synced').classList.add('is-paused'); }
  finally { refreshing = false; }
}
// The Clipboard API needs a secure context; the Tailscale http:// address is not one.
async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard) return navigator.clipboard.writeText(text);
  const focused = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;opacity:0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  focused?.focus();
  if (!copied) throw new Error('the browser blocked clipboard access');
}
// The selected format stays selected across runs; Copy takes whichever one is shown.
const formats = { html: 'HTML', md: 'Markdown', json: 'JSON' };
let format = 'html';
const reportUrl = (name) => $('report').dataset.report.replace(/report\.html$/, `report.${name}`);
async function reportText(name) {
  const response = await fetch(reportUrl(name));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function showFormat(next) {
  format = next;
  for (const button of document.querySelectorAll('[data-format]')) button.setAttribute('aria-pressed', String(button.dataset.format === format));
  $('report').hidden = format !== 'html';
  $('report-text').hidden = format === 'html';
  $('report-link').href = reportUrl(format);
  $('copy-message').textContent = '';
  if (format === 'html') return;
  $('report-text').textContent = 'Loading…';
  const text = await reportText(format).catch((error) => `Could not load the ${formats[format]} report: ${error.message}`);
  if (format === next) $('report-text').textContent = text;
}
$('report-section').addEventListener('click', (event) => { const next = event.target.closest('[data-format]')?.dataset.format; if (next) void showFormat(next); });
$('copy-report').addEventListener('click', async () => {
  const name = formats[format];
  try {
    await copyText(await reportText(format));
    $('copy-message').textContent = `Copied the full ${name} report.`;
  } catch (error) { $('copy-message').textContent = `Could not copy the ${name} report: ${error.message}`; }
});
let originalSource = null;
let editorName = '';
let dirty = false;
let basicDirty = false;
const guided = Object.entries(configFields).filter(([, field]) => field.guided);
html('config-fields', guided.map(([key, field]) => `<label class="ds-field">${escape(field.label)}<input id="field-${key}" class="ds-input" placeholder="${escape(field.example)}" data-field="${key}"></label>`).join(''));
html('field-reference', Object.entries(configFields).map(([key, field]) => `<option value="${escape(key)}">${escape(key)} · ${escape(field.label)}</option>`).join(''));
function suggest(key) {
  const field = configFields[key];
  $('field-reference').value = key;
  html('field-suggestion', `<p><strong>${escape(field.label)}</strong> · ${escape(field.type)}</p><p>${escape(field.help)}</p><p>Example</p><pre>${escape(field.example)}</pre>`);
}
suggest('repo');
$('field-reference').addEventListener('change', () => suggest($('field-reference').value));
$('config-fields').addEventListener('focusin', (event) => { if (event.target.dataset.field) suggest(event.target.dataset.field); });
function suggestYAML() {
  const parents = [];
  for (const line of $('config-source').value.slice(0, $('config-source').selectionStart).split('\n')) {
    const match = /^( *)([A-Za-z][A-Za-z0-9]*):/.exec(line);
    if (!match) continue;
    while (parents.length && parents.at(-1).indent >= match[1].length) parents.pop();
    parents.push({ indent: match[1].length, key: match[2] });
  }
  while (parents.length) {
    const key = parents.map((item) => item.key).join('.');
    if (configFields[key]) { suggest(key); break; }
    parents.pop();
  }
}
for (const event of ['focus', 'click', 'keyup']) $('config-source').addEventListener(event, suggestYAML);
$('config-editor').addEventListener('input', (event) => { dirty = true; if (event.target.dataset.field) basicDirty = true; });
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
const configRequest = (url, method, data) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
function message(text) { $('config-message').textContent = text; }
async function draft(apply = false) {
  const result = await configRequest('/api/config-draft', 'POST', { source: $('config-source').value,
    ...(apply ? { fields: Object.fromEntries(guided.map(([key]) => [key, $(`field-${key}`).value])) } : {}) });
  if (apply) { $('config-source').value = result.source; dirty = true; }
  for (const [key, value] of Object.entries(result.fields)) $(`field-${key}`).value = value;
  basicDirty = false;
}
async function openEditor(name = '', generated = null) {
  if (dirty && !confirm('Discard unsaved configuration changes?')) return;
  try {
    const result = generated ?? (name ? await api(`/api/configs/${encodeURIComponent(name)}`) : { source: 'repo: /absolute/path/to/my-app\nbaseBranch: main\nworkdir: .\ninstall: npm ci\n\nchecks:\n  - name: tests\n    run: npm test\n    parser: generic\n' });
    const targetName = name || generated?.existingName || '';
    editorName = targetName;
    originalSource = generated?.previous ?? (name ? result.source : null);
    $('config-source').value = result.source;
    $('config-name').value = name || generated?.name || '';
    $('config-name').readOnly = !!targetName;
    $('editor-title').textContent = targetName ? `Edit ${targetName}` : 'New configuration';
    $('delete-config').hidden = !targetName;
    $('config-editor').hidden = false;
    dirty = false;
    basicDirty = false;
    message(generated?.notes.join(' ') ?? '');
    $('setup-details').hidden = !generated;
    if (generated) {
      $('setup-details').open = true;
      html('setup-coverage', (generated.coverage ?? []).map((item) => `<tr><td>${escape(item.field)}</td><td><span class="ds-chip ${({ preserved: 'ds-chip-success', detected: 'ds-chip-success', review: 'ds-chip-warning', inferred: 'ds-chip-primary' })[item.status] ?? ''}">${escape(item.status)}</span></td><td>${escape(item.evidence)}</td></tr>`).join(''));
      html('setup-existing', (generated.existingConfigs ?? []).map((existing) => `<button class="ds-button button-secondary" type="button" data-existing="${escape(existing)}" ${existing === generated.existingName ? 'disabled' : ''}>Reuse ${escape(existing)}</button>`).join(''));
    }
    for (const [key] of guided) $(`field-${key}`).value = '';
    try { await draft(); } catch (error) { message(`Repair the YAML below: ${error.message}`); }
    if (generated) dirty = true;
    $('config-name').focus();
    return true;
  } catch (error) { showError(error); }
}
let folder = '';
async function browseFolders(next) {
  try {
    const result = await api(`/api/project-folders${next ? `?folder=${encodeURIComponent(next)}` : ''}`);
    folder = result.folder;
    $('folder-path').textContent = folder;
    html('folder-list', `${result.parent ? `<button class="ds-button button-secondary folder-button" type="button" data-folder="${escape(result.parent)}">↑ Parent folder</button>` : ''}${result.folders.map((entry) => `<button class="ds-button button-secondary folder-button" type="button" data-folder="${escape(entry.path)}">${escape(entry.name)} →</button>`).join('') || '<p class="muted">No subfolders</p>'}`);
    $('folder-message').textContent = '';
    $('detect-project').disabled = false;
  } catch (error) { $('folder-message').textContent = error.message; }
}
$('setup-project').addEventListener('click', async () => {
  $('folder-picker').hidden = false;
  $('detect-project').disabled = true;
  await browseFolders();
});
$('folder-list').addEventListener('click', (event) => { const next = event.target.closest('[data-folder]')?.dataset.folder; if (next) void browseFolders(next); });
$('setup-existing').addEventListener('click', async (event) => {
  const existingName = event.target.closest('[data-existing]')?.dataset.existing;
  if (!existingName) return;
  try {
    const generated = await configRequest('/api/project-setup', 'POST', { folder, existingName });
    await openEditor('', generated);
  } catch (error) { message(error.message); }
});
$('close-folders').addEventListener('click', () => { $('folder-picker').hidden = true; });
$('detect-project').addEventListener('click', async () => {
  $('detect-project').disabled = true;
  try {
    const generated = await configRequest('/api/project-setup', 'POST', { folder });
    if (await openEditor('', generated)) $('folder-picker').hidden = true;
  } catch (error) { $('folder-message').textContent = error.message; }
  finally { $('detect-project').disabled = false; }
});
$('new-config').addEventListener('click', () => openEditor());
$('config-list').addEventListener('click', (event) => { const name = event.target.closest('[data-config]')?.dataset.config; if (name) void openEditor(name); });
$('apply-fields').addEventListener('click', async () => { try { await draft(true); message('Basic fields applied. Review the YAML, then save.'); } catch (error) { message(error.message); } });
$('read-fields').addEventListener('click', async () => { try { await draft(); message('Basic fields updated from YAML.'); } catch (error) { message(error.message); } });
$('config-editor').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('save-config').disabled = true;
  try {
    if (basicDirty) await draft(true);
    const name = editorName || $('config-name').value;
    const result = await configRequest(`/api/configs/${encodeURIComponent(name)}`, 'PUT', { source: $('config-source').value, previous: originalSource });
    originalSource = result.source;
    editorName = name;
    $('config-name').readOnly = true;
    $('delete-config').hidden = false;
    $('editor-title').textContent = `Edit ${name}`;
    dirty = false;
    message('Configuration saved.');
    await refresh();
  } catch (error) { message(error.message); }
  finally { $('save-config').disabled = false; }
});
$('delete-config').addEventListener('click', async () => {
  if (!confirm(`Delete configuration “${editorName}”? Existing reports and fixtures stay on disk.`)) return;
  try {
    await configRequest(`/api/configs/${encodeURIComponent(editorName)}`, 'DELETE', { previous: originalSource });
    dirty = false;
    $('config-editor').hidden = true;
    await refresh();
  } catch (error) { message(error.message); }
});
$('close-config').addEventListener('click', () => { if (!dirty || confirm('Discard unsaved configuration changes?')) { dirty = false; $('config-editor').hidden = true; } });
const size = (bytes) => { let i = 0; while (bytes >= 1024 && i < 3) { bytes /= 1024; i++; } return i ? `${bytes.toFixed(1)} ${['B', 'KB', 'MB', 'GB'][i]}` : `${bytes} B`; };
const retentionFields = { keepRuns: ['keep-runs', 'SPOTTER_KEEP_RUNS'], keepBaselines: ['keep-baselines', 'SPOTTER_KEEP_BASELINES'], autoPrune: ['auto-prune', 'SPOTTER_AUTO_PRUNE'] };
let retentionDirty = false;
let pending = 0;
let pendingBytes = 0;
function updateCleanup() {
  $('cleanup-now').disabled = retentionDirty || !pending;
  if (retentionDirty) $('cleanup-message').textContent = 'Save settings before cleaning up.';
  else if ($('cleanup-message').textContent === 'Save settings before cleaning up.') $('cleanup-message').textContent = '';
}
async function loadStorage() {
  try {
    const { settings, locked, projects: usage } = await api('/api/storage');
    for (const [key, [id, variable]] of Object.entries(retentionFields)) {
      if (!retentionDirty) $(id)[key === 'autoPrune' ? 'checked' : 'value'] = settings[key];
      $(id).disabled = locked[key];
      $(`${id}-help`).textContent = locked[key] ? `Set on the server by ${variable}.` : '';
    }
    let total = 0;
    pending = 0;
    pendingBytes = 0;
    html('storage-projects', usage.map((p) => {
      total += p.runs.bytes + p.baselines.bytes + p.work.bytes;
      pending += p.cleanup.count;
      pendingBytes += p.cleanup.bytes;
      const cell = (part) => `<td class="num">${part.count} · ${size(part.bytes)}</td>`;
      return `<tr><td><strong>${escape(p.name)}</strong></td>${cell(p.runs)}${cell(p.baselines)}${cell(p.work)}<td>${p.cleanup.count ? `${p.cleanup.count} item(s) · ${size(p.cleanup.bytes)}` : 'Nothing to remove'}${p.cleanup.skipped ? `<br><span class="muted">${escape(p.cleanup.skipped)}</span>` : ''}</td></tr>`;
    }).join(''));
    $('storage-total').textContent = usage.length ? `Total on disk: ${size(total)}. Cleanup would remove ${pending} item(s) · ${size(pendingBytes)}. Sizes are measured when this page opens or is refreshed.` : 'No projects configured yet.';
    updateCleanup();
  } catch (error) { $('storage-total').textContent = `Could not load storage: ${error.message}`; }
}
$('refresh-storage').addEventListener('click', loadStorage);
$('retention-form').addEventListener('input', () => { retentionDirty = true; updateCleanup(); });
$('retention-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('save-retention').disabled = true;
  try {
    await configRequest('/api/retention', 'PUT', { keepRuns: Number($('keep-runs').value), keepBaselines: Number($('keep-baselines').value), autoPrune: $('auto-prune').checked });
    retentionDirty = false;
    $('retention-message').textContent = 'Settings saved.';
    await loadStorage();
  } catch (error) { $('retention-message').textContent = error.message; }
  finally { $('save-retention').disabled = false; }
});
$('cleanup-now').addEventListener('click', async () => {
  if (!confirm(`Delete ${pending} item(s) (${size(pendingBytes)}) now? In-progress runs and the latest run are kept.`)) return;
  $('cleanup-now').disabled = true;
  try {
    const result = await configRequest('/api/cleanup', 'POST', {});
    await loadStorage();
    $('cleanup-message').textContent = `Removed ${result.removed} item(s).${result.skipped.length ? ` Skipped baselines and work folders for ${result.skipped.join(', ')} because a run is in progress.` : ''}`;
  } catch (error) { $('cleanup-message').textContent = error.message; updateCleanup(); }
});
window.addEventListener('hashchange', () => { void refresh(); if (location.hash === '#storage') void loadStorage(); });
if (location.hash === '#storage') void loadStorage();
try {
  await refresh();
  setInterval(refresh, 2000);
} catch (error) { showError(error); }
