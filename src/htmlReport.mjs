import path from 'node:path';
import { summarizeCompleteness } from './completeness.mjs';
import { budgetMetrics, formatValue, isTiming as isTimed } from './performance.mjs';
import { describeBase, describeCounts, describeVisual, formatDuration, groupFindings, renderPlace, renderStageSummary, resultOf } from './report.mjs';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const url = (value) => value.split('/').map(encodeURIComponent).join('/');

const coverage = (completeness) => !completeness ? '' : `<h2>Coverage</h2><p>${escape(summarizeCompleteness(completeness))}</p>${(completeness.notes ?? []).map((note) => `<p>Note: ${escape(note)}</p>`).join('')}${completeness.level?.unsupported?.length ? `<p>Not available at level high: ${escape(completeness.level.unsupported.map((item) => `${item.name} (${item.ticket})`).join(', '))}</p>` : ''}${completeness.status === 'incomplete' ? `<ul>${completeness.gaps.map((gap) => `<li>${escape(gap)}</li>`).join('')}</ul>` : ''}<div class="table-wrap"><table class="coverage"><thead><tr><th>Name</th><th>Kind</th><th>Required</th><th>Status</th><th>Reason</th></tr></thead><tbody>${completeness.items.map((item) => `<tr><td>${escape(item.name)}</td><td>${escape(item.kind)}</td><td>${item.required ? 'yes' : 'no'}</td><td><span class="badge status-${escape(item.status)}">${escape(item.status)}</span></td><td>${escape(item.reason)}</td></tr>`).join('')}</tbody></table></div>`;

const perfValue = (metric, value) => (value === undefined ? '' : formatValue(metric, value));
const perfTiming = (metric, timing) => timing ? `${perfValue(metric, timing.median)} (${timing.min.toFixed(1)}–${timing.max.toFixed(1)})` : '';
const perfBudget = (metric, budget) => [budget.max !== null && `max ${perfValue(metric, budget.max)}`, budget.maxIncrease && `+${budget.maxIncrease.percent !== undefined ? `${budget.maxIncrease.percent}%` : perfValue(metric, budget.maxIncrease.amount)}`, budget.blocking && 'blocking'].filter(Boolean).join(' ');
const performance = ({ performance: perf }) => {
  if (!perf?.head) return perf ? '<h2>Performance</h2><p>Not measured.</p>' : '';
  const { head, base, budgets } = perf;
  const rows = [...Object.keys(head.resources ?? {}), ...Object.keys(head.timings ?? {})].map((metric) => {
    const timed = isTimed(metric);
    const [from, to] = timed ? [base?.timings?.[metric]?.median, head.timings[metric].median] : [base?.resources?.[metric], head.resources[metric]];
    const change = from === undefined || perf.notCompared.some((item) => item.metric === metric) ? '' : `${to - from >= 0 ? '+' : '−'}${perfValue(metric, Math.abs(to - from))}`;
    const limits = budgets.filter((budget) => budgetMetrics(budget, [metric]).length).map((budget) => perfBudget(metric, budget)).join('; ');
    return `<tr><td>${escape(metric)}</td><td>${escape(timed ? perfTiming(metric, base?.timings?.[metric]) : perfValue(metric, base?.resources?.[metric]))}</td><td>${escape(timed ? perfTiming(metric, head.timings[metric]) : perfValue(metric, head.resources[metric]))}</td><td>${escape(change)}</td><td>${escape(limits)}</td></tr>`;
  });
  const { environment } = head;
  return `<h2>Performance</h2>${environment ? `<p class="muted">${escape(`${environment.browser}, ${environment.cpus} CPUs, ${environment.samples} samples, ${environment.api === 'replayed' ? 'API replayed' : 'API not used'}`)}</p>` : ''}${head.timingError ? `<p>Timings failed: ${escape(head.timingError)}</p>` : ''}<div class="table-wrap"><table class="performance"><thead><tr><th>Metric</th><th>Base</th><th>Head</th><th>Change</th><th>Budget</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>${head.timings ? '<p class="muted">Timings use replayed API responses and measure the front end, not backend performance.</p>' : ''}`;
};

const css = String.raw`:root{--bg:#fff;--fg:#1d2024;--muted:#5d6570;--border:#d3d8de;--link:#125bbb;--surface:#f2f4f7;--ok-bg:#dff3e3;--ok-fg:#14602a;--warn-bg:#fdf0cc;--warn-fg:#7a4b00;--bad-bg:#fbe0dd;--bad-fg:#9c1c12;--info-bg:#dde9fa;--info-fg:#1b4f9c;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#14171a;--fg:#e6e9ed;--muted:#9aa3ad;--border:#363c44;--link:#7db3ff;--surface:#1f2429;--ok-bg:#1c3a25;--ok-fg:#8fdba1;--warn-bg:#40320f;--warn-fg:#f2c75c;--bad-bg:#47201c;--bad-fg:#ff9d92;--info-bg:#1d3252;--info-fg:#9cc4ff}}
body{font:16px/1.5 system-ui;margin:2rem auto;max-width:1100px;padding:0 1rem;color:var(--fg);background:var(--bg)}
a{color:var(--link)}h1{margin-bottom:.25rem}h2{margin:2rem 0 .5rem}.meta,.muted{color:var(--muted);font-size:.875rem;margin:.25rem 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}pre.detail{margin:.25rem 0;padding:.5rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:.8125rem}
.result{margin:1rem 0;padding:.75rem 1rem;border-left:6px solid var(--info-fg);background:var(--info-bg);color:var(--info-fg);border-radius:4px}
.result-pass{border-color:var(--ok-fg);background:var(--ok-bg);color:var(--ok-fg)}.result-fail{border-color:var(--bad-fg);background:var(--bad-bg);color:var(--bad-fg)}.result-incomplete{border-color:var(--warn-fg);background:var(--warn-bg);color:var(--warn-fg)}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:.5rem .75rem;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:var(--surface)}
.badge{display:inline-block;padding:.125rem .625rem;border-radius:999px;font-size:.75rem;font-weight:700;white-space:nowrap;background:var(--info-bg);color:var(--info-fg)}
.sev-high,.status-fail,.status-failed,.status-missing{background:var(--bad-bg);color:var(--bad-fg)}.sev-medium,.status-incomplete,.status-skipped{background:var(--warn-bg);color:var(--warn-fg)}.sev-low,.status-excluded{background:var(--info-bg);color:var(--info-fg)}.status-pass,.status-executed,.status-complete{background:var(--ok-bg);color:var(--ok-fg)}
.performance th,.performance td{white-space:nowrap;overflow-wrap:normal}.checks{padding-left:1.25rem}.findings th:nth-child(3){width:55%}
@media (max-width:600px){.findings thead{display:none}.findings tr{display:grid;grid-template-columns:2rem 1fr;border-bottom:1px solid var(--border);padding:.5rem 0}.findings td{border:0;padding:.25rem .5rem}.findings td:nth-child(n+3){grid-column:1/-1}}
.shots,.images{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem}
figure{margin:0;min-width:0}figcaption{font-size:.875rem;color:var(--muted)}img{width:100%;border:1px solid var(--border);border-radius:4px}
section{margin:1.5rem 0}summary{cursor:pointer}details{margin:.5rem 0}
@page{margin:12mm}
@media print{:root{--bg:#fff;--fg:#1d2024;--muted:#5d6570;--border:#d3d8de;--link:#125bbb;--surface:#f2f4f7;--ok-bg:#dff3e3;--ok-fg:#14602a;--warn-bg:#fdf0cc;--warn-fg:#7a4b00;--bad-bg:#fbe0dd;--bad-fg:#9c1c12;--info-bg:#dde9fa;--info-fg:#1b4f9c;color-scheme:light}body{margin:0;max-width:none}details::details-content{content-visibility:visible}tr,figure,section{break-inside:avoid}*{print-color-adjust:exact}body>p:has(a[href="report.md"]){display:none}}`;

/** Static, script-free HTML with relative links, suitable for Caddy or build artifacts. */
export function renderHtmlReport(run, markdown) {
  const groups = groupFindings(run.comparison.newFindings);
  const visuals = run.visual?.changes ?? [];
  const variantCount = run.head.stages.web?.variantCount;
  const result = resultOf(run);
  const image = (label, file) => file ? `<figure><figcaption>${label}</figcaption><a href="${url(file)}"><img loading="lazy" alt="${label}" src="${url(file)}"></a></figure>` : '';
  const row = (group, index) => {
    const { first } = group;
    const detail = first.detail ? `<pre class="detail">${escape(first.detail.split('\n').slice(0, 3).join('\n'))}</pre>` : '';
    const repro = first.repro ? `<div class="muted">repro: <code>${escape(first.repro)}</code></div>` : '';
    return `<tr><td>${index + 1}</td><td><span class="badge sev-${escape(first.severity)}">${escape(first.severity)}</span></td><td><strong>${escape(first.title)}</strong><div class="muted">${escape(first.stage)}/${escape(first.check)}</div>${detail}${repro}</td><td>${group.members.length > 1 ? `${group.members.length}× ` : ''}${escape(renderPlace(group, variantCount))}</td></tr>`;
  };
  const findings = groups.length
    ? `<h2>New on this branch (${groups.length})</h2><div class="table-wrap"><table class="findings"><thead><tr><th>#</th><th>Severity</th><th>Issue</th><th>Where</th></tr></thead><tbody>${groups.slice(0, 25).map(row).join('')}</tbody></table></div>${groups.length > 25 ? `<p class="muted">…and ${groups.length - 25} more groups in report.json.</p>` : ''}`
    : '<h2>New on this branch</h2><p>Nothing new.</p>';
  const withShots = groups.filter(({ first }) => first.artifacts?.length);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spotter: ${escape(run.project)}</title>
<style>
${css}
</style>
<h1>Spotter: ${escape(run.project)}</h1><p class="meta">head: ${escape(run.head.label)} @ ${escape(run.head.shortSha)} · base: ${escape(describeBase(run))} · ${escape(formatDuration(run.durationMs))}</p>
<p><a href="report.md">Markdown</a> · <a href="report.json">JSON</a> · <a href="logs/">Logs</a></p>
<p class="result result-${result.toLowerCase()}"><strong>${result}</strong> — ${escape(describeCounts(run.comparison))}</p>
${findings}
<h2>Checks</h2><ul class="checks">${renderStageSummary(run).map((line) => `<li>${escape(line.replace(/^- /, ''))}</li>`).join('')}</ul>
${coverage(run.completeness)}
${performance(run)}
${withShots.length ? `<h2>Screenshots</h2>${withShots.map(({ first }) => `<section class="evidence"><h3>${escape(first.title)}</h3><div class="shots">${first.artifacts.map((file) => image('Screenshot', `screenshots/${path.basename(file)}`)).join('')}</div></section>`).join('')}` : ''}
<h2>Visual review (advisory)</h2><p>${escape(run.visual?.status === 'compared' ? describeVisual(run.visual) : run.visual?.status ?? 'not checked')}</p>
${visuals.map((change) => `<details><summary>${escape(change.name)} — ${escape(change.status)}</summary><div class="images">${image('Before', change.before)}${image('After', change.after)}${image('Diff', change.diff)}</div></details>`).join('\n')}
<details class="plain"><summary>Plain-text report (report.md)</summary><pre>${escape(markdown)}</pre></details>
</html>\n`;
}
