/** Names usable in coverage.required for this (raw or normalized) config. */
export function requirableNames(config) {
  const names = (Array.isArray(config.checks) ? config.checks : []).map((check) => check?.name).filter((name) => typeof name === 'string');
  names.push('rules');
  const web = config.web;
  if (web) {
    names.push('web');
    if (web.api) names.push('fixtures');
    if (web.specs) names.push('specs');
    for (const session of Array.isArray(web.sessions) ? web.sessions : []) {
      if (session?.expectSelector !== undefined && typeof session.name === 'string') names.push(session.name);
    }
  }
  return names;
}

/** Fixture identity recorded in reports; null when fixtures is null. */
export function describeFixtures(fixtures, now = Date.now()) {
  if (!fixtures) return null;
  return {
    recordedAt: fixtures.recordedAt,
    hash: fixtures.hash,
    ref: fixtures.ref ?? null,
    sha: fixtures.sha?.slice(0, 7) ?? null,
    ageDays: Math.floor((now - Date.parse(fixtures.recordedAt)) / 86_400_000),
  };
}

/** Builds the C5 items for one side's stages. */
function listItems({ config, skip, stages, fixtures, liveAuth }) {
  const required = config.coverage?.required ?? [];
  const items = [];
  const add = (name, kind, status, reason = null) => {
    const item = { name, kind, required: required.includes(name), status, reason };
    items.push(item);
    return item;
  };
  const installFailed = Array.isArray(stages.static) && stages.static.some((check) => check.name === 'install' && check.status === 'FAIL');
  for (const { name } of config.checks) {
    if (skip.has('static')) add(name, 'check', 'skipped', '--skip static');
    else if (Array.isArray(stages.static) && stages.static.some((check) => check.name === name)) add(name, 'check', 'executed');
    else add(name, 'check', 'missing', installFailed ? 'dependency install failed' : 'did not run');
  }
  if (stages.rules === 'skipped') add('rules', 'stage', 'skipped', '--skip rules');
  else add('rules', 'stage', 'executed');
  if (!config.web) return items;

  const web = stages.web;
  let webItem;
  if (liveAuth) webItem = add('web', 'stage', 'skipped', 'live authentication runs project specs only');
  else if (skip.has('web')) webItem = add('web', 'stage', 'skipped', '--skip web');
  else if (web === 'skipped') webItem = add('web', 'stage', 'missing', 'dependency install failed');
  else if (web?.built === false) webItem = add('web', 'stage', 'missing', 'build failed');
  else webItem = add('web', 'stage', 'executed');
  const webDown = webItem.status !== 'executed';

  if (config.web.specs) {
    const specs = web?.specs;
    if (webDown && !liveAuth) add('specs', 'specs', webItem.status, webItem.reason);
    else if (!specs) add('specs', 'specs', 'missing', 'did not run');
    else if (specs.selected === 0) add('specs', 'specs', 'missing', 'selected zero tests');
    else if (!specs.completed) add('specs', 'specs', 'missing', 'runner could not complete');
    else add('specs', 'specs', 'executed');
  }
  for (const { name, expectSelector } of config.web.sessions) {
    if (expectSelector === undefined) continue;
    const check = web?.sessionChecks?.[name];
    if (liveAuth) add(name, 'session', 'skipped', 'live authentication');
    else if (webDown) add(name, 'session', webItem.status, webItem.reason);
    else if (!check?.checked) add(name, 'session', 'missing', 'not visited');
    else if (check.failed > 0) add(name, 'session', 'missing', `expected state not reached on ${check.failed}/${check.checked} visits (${expectSelector} not found)`);
    else add(name, 'session', 'executed');
  }
  if (config.web.api && !liveAuth) {
    if (fixtures) add('fixtures', 'fixtures', 'executed');
    else add('fixtures', 'fixtures', 'missing', `no fixtures recorded; run spotter record ${config.name}`);
  }
  return items;
}

/** Whether the base comparison can be trusted. */
export function assessBaseline({ config, skip, headStages, baseStages, baseSha, headSha, workingTree, cached, error, liveAuth }) {
  const result = (status, reason = null) => ({ status, reason });
  if (liveAuth) return result('none', 'live authentication runs without a baseline');
  if (!baseSha) return result('none', 'disabled by --no-baseline');
  if (baseSha === headSha && !workingTree) return result('same-commit');
  if (error) return result('failed', `base run failed: ${String(error.message).split('\n')[0]}`);
  const own = (stages) => listItems({ config, skip, stages, fixtures: null, liveAuth }).filter((item) => item.kind === 'check' || item.kind === 'stage');
  const base = new Map(own(baseStages ?? {}).map((item) => [item.name, item.status]));
  const names = own(headStages).filter((item) => item.status === 'executed' && base.get(item.name) !== 'executed').map((item) => item.name);
  if (names.length) return result('failed', `base did not run: ${names.join(', ')}`);
  return result(cached ? 'cached' : 'compared');
}

/** The completeness record stored as report.json `completeness`. */
export function assessCompleteness({ config, skip, stages, fixtures, baseline, liveAuth, level = null, now = Date.now() }) {
  const excluded = level?.exclusions ?? [];
  const items = listItems({ config, skip, stages, fixtures, liveAuth }).filter((item) => !excluded.some((e) => e.name === item.name && e.kind === item.kind));
  for (const { name, kind, reason } of excluded) items.push({ name, kind, required: false, status: 'excluded', reason });
  const web = items.find((item) => item.name === 'web');
  const summary = web?.status === 'executed' ? stages.web : null;
  const specsSummary = stages.web?.specs;
  const counts = { pages: null, faultVisits: null, specs: null };
  if (web && !liveAuth) {
    const w = config.web;
    const expected = w.routes.length * w.viewports.length * w.colorSchemes.length * w.sessions.length;
    const failed = summary ? summary.pagesFailed ?? 0 : 0;
    const executed = summary ? summary.pages - failed : 0;
    counts.pages = { expected, executed, failed, skipped: expected - executed - failed };
  }
  if (summary?.faultVisits > 0) {
    const failed = summary.faultVisitsFailed ?? 0;
    counts.faultVisits = { executed: summary.faultVisits - failed, failed };
  }
  if (specsSummary) {
    const { selected, passed, failed, flaky, skipped } = specsSummary;
    counts.specs = { selected, executed: selected - skipped, passed, failed, flaky: flaky ?? 0, skipped, min: config.coverage?.minSpecs ?? null };
  }

  const gaps = items.filter((item) => item.status === 'missing').map((item) => `${item.name}: ${item.reason}`);
  for (const item of items) if (item.required && item.status === 'skipped') gaps.push(`${item.name}: required but skipped (${item.reason})`);
  if (counts.pages?.failed > 0) gaps.push(`${counts.pages.failed} of ${counts.pages.expected} page visits failed to load`);
  if (counts.faultVisits?.failed > 0) gaps.push(`${counts.faultVisits.failed} fault visits failed to load`);
  const min = config.coverage?.minSpecs ?? null;
  const specsExecuted = counts.specs?.executed ?? 0;
  if (min && specsExecuted < min) gaps.push(`specs: ${specsExecuted} executed, minimum ${min}`);
  if (baseline.status === 'failed') gaps.push(`baseline: ${baseline.reason}`);

  return { status: gaps.length ? 'incomplete' : 'complete', gaps, items, counts, fixtures: describeFixtures(fixtures, now), baseline, level };
}

/** One line shared by Markdown, HTML and dashboard. */
export function summarizeCompleteness({ status, counts, baseline, fixtures, items, level }) {
  const parts = [status === 'complete' ? 'COMPLETE' : 'INCOMPLETE'];
  if (level) parts.push(`level ${level.name}`);
  if (counts.pages) parts.push(`${counts.pages.executed}/${counts.pages.expected} configured page visits loaded`);
  if (counts.specs) parts.push(`specs ${counts.specs.executed} of ${counts.specs.selected} executed${counts.specs.min ? ` (min ${counts.specs.min})` : ''}`);
  parts.push(`baseline ${baseline.status}`);
  if (fixtures) parts.push(`fixtures ${fixtures.recordedAt.slice(0, 10)} (${fixtures.ageDays}d old, ${fixtures.hash})`);
  const skipped = items.filter((item) => item.status === 'skipped' && !item.required);
  if (skipped.length) parts.push(`skipped: ${skipped.map((item) => `${item.name} (${item.reason})`).join(', ')}`);
  const excluded = items.filter((item) => item.status === 'excluded');
  if (excluded.length) parts.push(`${excluded.length} excluded by level`);
  return parts.join(' · ');
}
