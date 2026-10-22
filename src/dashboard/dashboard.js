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
    const previousProject = $('project').value;
    const previousBranch = $('branch').value;
    const [nextProjects, runs] = await Promise.all([api('/api/projects'), api('/api/runs')]);
    projects = nextProjects;
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
window.addEventListener('hashchange', refresh);
try {
  await refresh();
  setInterval(refresh, 2000);
} catch (error) { showError(error); }
