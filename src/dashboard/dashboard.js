import { configFields } from '/config-fields.mjs';
const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const badge = (status) => `<span class="ds-chip ds-chip-${status === 'pass' ? 'success' : status === 'running' ? 'primary' : 'danger'}">${escape(status.toUpperCase())}</span>`;
const link = (run) => `#run/${encodeURIComponent(run.project)}/${encodeURIComponent(run.id)}`;
const time = (at) => at ? new Date(at).toLocaleString() : 'Not recorded';
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
  $('project-info').textContent = project?.error ?? `Compare against ${project?.baseBranch ?? 'main'}. Runs use recorded API fixtures.`;
  $('submit').disabled = !$('branch').value;
}
$('project').addEventListener('change', () => updateBranches());
$('start').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('submit').disabled = true;
  showError(null);
  try {
    const run = await api('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: $('project').value, branch: $('branch').value }) });
    location.hash = link(run);
    await refresh();
    $('detail-title').focus();
  } catch (error) { showError(error); }
  finally { $('submit').disabled = !$('branch').value; }
});
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    $('page-title').textContent = location.hash === '#configs' ? 'Configure your checks.' : 'See what changed.';
    $('page-description').textContent = location.hash === '#configs' ? 'Build a project configuration with field guidance and examples.' : 'Start a check, follow the work, and review what Spotter found.';
    $('config-page').hidden = location.hash !== '#configs';
    $('run-page').hidden = location.hash === '#configs';
    const previousProject = $('project').value;
    const previousBranch = $('branch').value;
    const [nextProjects, runs] = await Promise.all([api('/api/projects'), api('/api/runs')]);
    projects = nextProjects;
    html('config-list', projects.map((p) => `<article class="ds-card ds-aero-surface"><h3>${escape(p.name)}</h3><button class="ds-button" type="button" data-config="${escape(p.name)}">Edit configuration</button></article>`).join('') || '<p>No configurations yet. Create one to get started.</p>');
    html('project', projects.map((p) => `<option>${escape(p.name)}</option>`).join(''));
    if (projects.some((p) => p.name === previousProject)) $('project').value = previousProject;
    updateBranches($('project').value === previousProject ? previousBranch : '');
    html('runs', runs.map((run) => `<tr><td><strong>${escape(run.project)}</strong><br>${escape(run.branch)}</td><td>${badge(run.status)}</td><td>${escape(run.current.at(-1)?.activity ?? (run.report ? 'Report ready' : run.error ?? 'Preparing'))}</td><td><a href="${link(run)}">${run.status === 'running' ? 'Follow activity' : 'View run'} →</a><br><small>${escape(time(run.startedAt))}</small></td></tr>`).join(''));
    $('empty').hidden = runs.length > 0;
    html('projects', projects.map((project) => {
      const latest = runs.find((run) => run.project === project.name);
      return `<article class="project-card ds-card ds-aero-surface"><h3>${escape(project.name)}</h3>${latest ? `${badge(latest.status)}<p>${escape(latest.branch)}</p><a href="${link(latest)}">Open latest run →</a>` : '<p class="muted">No runs yet</p>'}</article>`;
    }).join(''));
    $('synced').textContent = `Refreshed ${new Date().toLocaleTimeString()} · every 2s`;
    const match = /^#run\/([^/]+)\/([^/]+)$/.exec(location.hash);
    $('detail').hidden = !match;
    if (match) {
      const key = `${match[1]}/${match[2]}`;
      const run = await api(`/api/runs/${key}`);
      $('identity').textContent = `${run.project} / ${run.branch} · ${run.id}`;
      html('status', badge(run.status));
      $('updated').textContent = `Last runner update: ${time(run.updatedAt)} · Checked ${new Date().toLocaleTimeString()}`;
      html('current', run.current.map((e) => `<li>${escape(e.side)} · ${escape(e.activity)}</li>`).join('') || (run.status === 'running' ? '' : '<li>Run finished</li>'));
      $('run-error').textContent = run.error ?? '';
      const history = $('events');
      const atBottom = history.scrollTop + history.clientHeight >= history.scrollHeight - 30;
      html('events', run.events.map((e) => `<li>${escape(time(e.at))} · ${escape(e.side)} · ${e.state === 'done' ? '✓ Completed' : '→ Started'} ${escape(e.activity)}</li>`).join('') || '<li>Preparing run…</li>');
      if (atBottom) history.scrollTop = history.scrollHeight;
      $('report-section').hidden = !run.report;
      if (run.report && $('report').getAttribute('src') !== run.report) {
        $('report').src = run.report;
        $('report-link').href = run.report;
      }
      if (key !== selected) { $('detail').scrollIntoView({ block: 'start' }); selected = key; }
    } else selected = '';
  } catch (error) { $('synced').textContent = `Updates paused: ${error.message}`; }
  finally { refreshing = false; }
}
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
    editorName = name;
    originalSource = name ? result.source : null;
    $('config-source').value = result.source;
    $('config-name').value = name || generated?.name || '';
    $('config-name').readOnly = !!name;
    $('editor-title').textContent = name ? `Edit ${name}` : 'New configuration';
    $('delete-config').hidden = !name;
    $('config-editor').hidden = false;
    dirty = false;
    basicDirty = false;
    message(generated?.notes.join(' ') ?? '');
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
    html('folder-list', `${result.parent ? `<button class="ds-button" type="button" data-folder="${escape(result.parent)}">↑ Parent folder</button>` : ''}${result.folders.map((entry) => `<button class="ds-button" type="button" data-folder="${escape(entry.path)}">${escape(entry.name)} →</button>`).join('') || '<p>No subfolders</p>'}`);
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
window.addEventListener('hashchange', refresh);
try {
  await refresh();
  setInterval(refresh, 2000);
} catch (error) { showError(error); }
