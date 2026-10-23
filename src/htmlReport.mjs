import path from 'node:path';
import { summarizeCompleteness } from './completeness.mjs';
import { groupFindings } from './report.mjs';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const url = (value) => value.split('/').map(encodeURIComponent).join('/');

const coverage = (completeness) => !completeness ? '' : `<h2>Coverage</h2><p>${escape(summarizeCompleteness(completeness))}</p>${completeness.status === 'incomplete' ? `<ul>${completeness.gaps.map((gap) => `<li>${escape(gap)}</li>`).join('')}</ul>` : ''}<table><thead><tr><th>Name</th><th>Kind</th><th>Required</th><th>Status</th><th>Reason</th></tr></thead><tbody>${completeness.items.map((item) => `<tr><td>${escape(item.name)}</td><td>${escape(item.kind)}</td><td>${item.required ? 'yes' : 'no'}</td><td>${escape(item.status)}</td><td>${escape(item.reason)}</td></tr>`).join('')}</tbody></table>`;

/** Static, script-free HTML with relative links, suitable for Caddy or build artifacts. */
export function renderHtmlReport(run, markdown) {
  const groups = groupFindings(run.comparison.newFindings);
  const visuals = run.visual?.changes ?? [];
  const image = (label, file) => file ? `<figure><figcaption>${label}</figcaption><a href="${url(file)}"><img loading="lazy" alt="${label}" src="${url(file)}"></a></figure>` : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spotter: ${escape(run.project)}</title>
<style>body{font:16px system-ui;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#222;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#125bbb}.images{display:flex;gap:1rem}figure{margin:0;min-width:0;flex:1}img{max-width:100%;border:1px solid #aaa}section{margin:2rem 0}summary{cursor:pointer}</style>
<h1>Spotter: ${escape(run.project)}</h1><p><a href="report.md">Markdown</a> · <a href="report.json">JSON</a> · <a href="logs/">Logs</a></p>
<pre>${escape(markdown)}</pre>
${coverage(run.completeness)}
${groups.map(({ first }) => `<section><h2>${escape(first.title)}</h2>${first.artifacts.map((file) => image('Screenshot', `screenshots/${path.basename(file)}`)).join('')}</section>`).join('')}
<h2>Visual review (advisory)</h2><p>${escape(run.visual?.status ?? 'not checked')} · ${visuals.length} changed pages · ${run.visual?.unchanged ?? 0} unchanged</p>
${visuals.map((change) => `<details><summary>${escape(change.name)} — ${escape(change.status)}</summary><div class="images">${image('Before', change.before)}${image('After', change.after)}${image('Diff', change.diff)}</div></details>`).join('\n')}
</html>\n`;
}
