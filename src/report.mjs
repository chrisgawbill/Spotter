import { summarizeCompleteness } from './completeness.mjs';
import { SEVERITIES } from './findings.mjs';

const STAGE_ORDER = ['static', 'rules', 'web', 'config'];
const MAX_GROUPS_SHOWN = 25;
const MAX_DETAIL_LINES = 3;
const MAX_PLACES_SHOWN = 6;

/** Known gaps, listed in every report so agents don't assume coverage that isn't there. */
function notChecked(run) {
  const web = run.head.stages.web;
  if (web?.specs?.mode === 'live') return ['branch comparison or automatic route sweep (live specs only)'];
  const gaps = [];
  if (run.visual?.status !== 'compared') gaps.push('visual changes vs base');
  if (!web?.sessions?.some((name) => name !== 'anonymous')) gaps.unshift('signed-in sweep (no sessions configured)');
  if (!web?.accessibility) gaps.unshift('accessibility (axe)');
  if (!web?.keyboard) gaps.unshift('keyboard smoke');
  if (!web?.faultVisits) gaps.unshift('slow or failing endpoints');
  return gaps;
}

/** 'INCOMPLETE' when coverage has gaps, 'FAIL' on any non-low new finding, else 'PASS'. */
export function resultOf(run) {
  if (run.completeness?.status === 'incomplete') return 'INCOMPLETE';
  return run.comparison.newFindings.some((finding) => finding.severity !== 'low') ? 'FAIL' : 'PASS';
}

/**
 * Renders the agent-facing markdown report. `run` holds head/base labels,
 * the comparison split, stage summaries, timings and artifact paths.
 */
export function renderMarkdownReport(run) {
  const { comparison } = run;
  const lines = [
    `# Spotter: ${run.project}`,
    '',
    `head: ${run.head.label} @ ${run.head.shortSha} · base: ${describeBase(run)} · ${formatDuration(run.durationMs)}`,
    `RESULT: ${resultOf(run)} — ${describeCounts(comparison)}`,
    ...(run.completeness?.notes ?? []).map((note) => `coverage note: ${note}`),
    '',
  ];
  if (run.completeness?.status === 'incomplete') lines.push(`## Incomplete coverage (${run.completeness.gaps.length})`, '', ...run.completeness.gaps.map((gap) => `- ${gap}`), '');

  const groups = groupFindings(comparison.newFindings);
  if (groups.length) {
    lines.push(`## New on this branch (${groups.length})`, '');
    const variantCount = run.head.stages.web?.variantCount;
    groups.slice(0, MAX_GROUPS_SHOWN).forEach((group, index) => lines.push(...renderGroup(group, index + 1, variantCount), ''));
    if (groups.length > MAX_GROUPS_SHOWN) {
      lines.push(`…and ${groups.length - MAX_GROUPS_SHOWN} more groups in report.json.`, '');
    }
  } else {
    lines.push('## New on this branch', '', 'Nothing new.', '');
  }

  const fixedGroups = groupFindings(comparison.fixedFindings);
  if (fixedGroups.length) {
    lines.push(`## Fixed vs base (${fixedGroups.length})`, '');
    fixedGroups
      .slice(0, 10)
      .forEach((group) => lines.push(`- ${group.first.stage}/${group.first.check}: ${group.first.title} — ${renderPlace(group)}`));
    if (fixedGroups.length > 10) lines.push(`- …and ${fixedGroups.length - 10} more in report.json`);
    lines.push('');
  }

  if (run.visual?.status === 'compared') lines.push(`Visual review (advisory): ${describeVisual(run.visual)} · ${run.paths.reportHtml}`, '');
  lines.push('## Checks', '', ...renderStageSummary(run), '');
  if (notChecked(run).length) lines.push(`Not checked: ${notChecked(run).join(', ')}.`);
  lines.push(`Details: ${run.paths.reportJson} · screenshots: ${run.paths.screenshots} · logs: ${run.paths.logs}`);
  return `${lines.join('\n')}\n`;
}

/** Collapses one problem seen in several files, routes, viewports or schemes into one entry. */
export function groupFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const groupKey = [finding.stage, finding.check, finding.title].join('|');
    if (!groups.has(groupKey)) groups.set(groupKey, { first: finding, members: [] });
    groups.get(groupKey).members.push(finding);
  }
  return [...groups.values()].sort(
    (left, right) =>
      SEVERITIES.indexOf(left.first.severity) - SEVERITIES.indexOf(right.first.severity) ||
      STAGE_ORDER.indexOf(left.first.stage) - STAGE_ORDER.indexOf(right.first.stage),
  );
}

function renderGroup(group, number, variantCount) {
  const { first } = group;
  const lines = [`${number}. [${first.severity}] ${first.stage}/${first.check} — ${first.title}`];
  const place = renderPlace(group, variantCount);
  if (place) lines.push(`   ${group.members.length > 1 ? `${group.members.length}× ` : ''}${place}`);
  if (first.detail) {
    first.detail
      .split('\n')
      .slice(0, MAX_DETAIL_LINES)
      .forEach((detailLine) => lines.push(`   > ${detailLine}`));
  }
  if (first.repro) lines.push(`   repro: ${first.repro}`);
  if (first.artifacts.length) lines.push(`   screenshot: ${first.artifacts[0]}`);
  return lines;
}

/**
 * Where a group occurs: `file:lines` for code, `route @ variants` for pages
 * ("all" when every viewport × scheme is affected). Long lists are cut short.
 */
export function renderPlace(group, variantCount) {
  const places = new Map();
  for (const member of group.members) {
    const [place, detail] = member.file ? [member.file, member.line] : (member.where ?? '').split(' @');
    if (!place) continue;
    if (!places.has(place)) places.set(place, []);
    if (detail) places.get(place).push(detail);
  }
  const rendered = [...places].map(([place, details]) => {
    const unique = [...new Set(details)];
    if (!unique.length) return place;
    if (group.first.file) return `${place}:${unique.slice(0, 5).join(',')}`;
    return `${place} @ ${unique.length === variantCount ? 'all' : unique.join(', ')}`;
  });
  const shown = rendered.slice(0, MAX_PLACES_SHOWN).join(' · ');
  return rendered.length > MAX_PLACES_SHOWN ? `${shown} · +${rendered.length - MAX_PLACES_SHOWN} more` : shown;
}

export function renderStageSummary(run) {
  const lines = [];
  for (const [stage, summary] of Object.entries(run.head.stages)) {
    if (summary === 'skipped') {
      lines.push(`- ${stage}: skipped`);
    } else if (stage === 'static') {
      lines.push(`- static: ${summary.map((check) => `${check.name} ${check.status}${check.count ? ` (${check.count})` : ''}`).join(' · ') || 'no checks'}`);
    } else if (stage === 'rules') {
      lines.push(`- rules: ${summary.ruleCount} text rules, ${summary.boundaryCount} import boundaries`);
    } else if (stage === 'config') {
      lines.push(`- config: ${summary.error ? `setup inference failed: ${summary.error}` : summary.missing ? `${summary.missing} inferred settings missing from the configuration` : 'matches setup inference'}`);
    } else if (stage === 'web') {
      if (summary.specs?.mode === 'live') {
        lines.push(`- live authentication: ${summary.specs.passed} passed, ${summary.specs.failed} failed, ${summary.specs.skipped} skipped (deployed app; no sweep)`);
        continue;
      }
      const fixtures = run.fixtures ? `fixtures recorded ${run.fixtures.recordedAt}` : 'no fixtures recorded';
      lines.push(`- web: ${summary.built ? `${summary.pages} page visits (${summary.shape})` : 'build failed, sweep skipped'} · ${fixtures}${summary.faultVisits ? ` · ${summary.faultVisits} fault visits` : ''}`);
      if (summary.specs) lines.push(`- project specs${summary.specs.mode ? ` (${summary.specs.mode})` : ''}: ${summary.specs.passed} passed, ${summary.specs.failed} failed, ${summary.specs.skipped} skipped`);
    }
  }
  if (run.plan) lines.push(`- plan: ${run.plan}`);
  if (run.completeness) lines.push(`- coverage: ${summarizeCompleteness(run.completeness)}`);
  return lines;
}

/** "3 new issues (1 high, 2 medium) · …" — counted per issue (group), not per occurrence. */
export function describeCounts({ newFindings, existingFindings, fixedFindings }) {
  const newGroups = groupFindings(newFindings);
  const bySeverity = SEVERITIES.map((severity) => [severity, newGroups.filter((group) => group.first.severity === severity).length])
    .filter(([, count]) => count)
    .map(([severity, count]) => `${count} ${severity}`);
  const newPart = newGroups.length ? `${newGroups.length} new issues (${bySeverity.join(', ')})` : 'nothing new';
  return `${newPart} · ${groupFindings(fixedFindings).length} fixed · ${groupFindings(existingFindings).length} already on base (not shown)`;
}

/** "4 changed · 12 added · 3 unchanged" — screenshots per comparison status, zero parts omitted. */
export function describeVisual(visual) {
  const counts = { changed: 0, added: 0, removed: 0 };
  for (const change of visual?.changes ?? []) counts[change.status]++;
  counts.unchanged = visual?.unchanged ?? 0;
  return Object.entries(counts).filter(([, count]) => count).map(([status, count]) => `${count} ${status}`).join(' · ') || 'no screenshots';
}

export function describeBase(run) {
  if (!run.base) return 'none (every finding shown)';
  if (run.base.sha === run.head.sha) return 'same commit (every finding shown)';
  return `${run.base.label} @ ${run.base.shortSha}`;
}

export function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
