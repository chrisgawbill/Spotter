#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listProjectNames, loadProjectConfig } from './config.mjs';
import { LEVELS, resolvePlan, summarizePlan } from './levels.mjs';
import { assessBaseline, assessCompleteness, describeFixtures } from './completeness.mjs';
import { compareWithBaseline, hasFailingFinding, sortFindings } from './findings.mjs';
import { loadFixtures, saveFixtures } from './fixtures.mjs';
import { compareContracts, snapshotContracts } from './contracts.mjs';
import { exportCommit, findMergeBase, listAddedLines, listCommitMessages, resolveCommit } from './git.mjs';
import { projectDirs, spotterCodeHash, spotterHome, toHostPath } from './paths.mjs';
import { createActivity } from './activity.mjs';
import { startDashboard } from './dashboard.mjs';
import { loadSavedRetention, pruneProject, retentionSettings } from './prune.mjs';
import { renderMarkdownReport } from './report.mjs';
import { renderHtmlReport } from './htmlReport.mjs';
import { compareScreenshots } from './visual.mjs';
import { readCachedSide, runSide, STAGES, writeCachedSide } from './runner.mjs';
import { runStaticStage } from './stages/static.mjs';
import { runWebStage } from './stages/web.mjs';

const USAGE = `Spotter — automatic QA that reports what is new on a branch.

  spotter run <project> [--ref <ref>] [--repo <path>] [--working-tree] [--no-baseline] [--live-auth] [--skip static,rules,web] [--level low|medium|high]
      Check <ref> (default: the checkout's HEAD) against its merge base with
      the base branch. --repo checks another clone or worktree of the project;
      --working-tree includes uncommitted changes. Prints report.md; exit 1 if anything new is high
      or medium, 3 if coverage is incomplete, 2 if Spotter itself failed.
      --level picks a testing level (default: the project's levels.default).
  spotter record <project> [--ref <ref>] [--repo <path>] [--merge]
      Visit every route against the live API and store its responses as the
      fixtures runs replay. --merge keeps existing entries and adds new ones.
  spotter prune [<project>] [--dry-run] [--keep-runs <n>] [--keep-baselines <n>]
      Delete older runs, unused baseline cache entries and leftover work folders.
      In-progress runs and runs/latest are kept. Defaults come from
      SPOTTER_KEEP_RUNS / SPOTTER_KEEP_BASELINES, else 10 and 5. The same cleanup
      runs after every run unless SPOTTER_AUTO_PRUNE=off.
  spotter dashboard
      Serve the dashboard on SPOTTER_TAILSCALE_IP:8089 (Tailscale IPv4 required).
  spotter list
      Configured projects.`;

const EXIT_PASS = 0;
const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;
const EXIT_INCOMPLETE = 3;

const log = (message) => process.stderr.write(`[spotter] ${message}\n`);

/** Parses `<command> <project> --flag value --switch` into a plain object. */
export function parseArguments(argv) {
  const [command, ...rest] = argv;
  const project = rest[0]?.startsWith('--') ? undefined : rest.shift();
  const flags = rest;
  const options = { command, project, skip: new Set() };
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === '--ref') options.ref = flags[++index];
    else if (flag === '--repo') options.repo = path.resolve(flags[++index]);
    else if (flag === '--working-tree') options.workingTree = true;
    else if (flag === '--no-baseline') options.noBaseline = true;
    else if (flag === '--live-auth') options.liveAuth = true;
    else if (flag === '--merge') options.merge = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--keep-runs') options.keepRuns = flags[++index];
    else if (flag === '--keep-baselines') options.keepBaselines = flags[++index];
    else if (flag === '--level') {
      options.level = flags[++index];
      if (!LEVELS.includes(options.level)) throw new Error(`Unknown level "${options.level}"; use low, medium or high`);
    } else if (flag === '--skip') {
      for (const stage of flags[++index].split(',')) options.skip.add(stage.trim());
    } else throw new Error(`Unknown option ${flag}`);
  }
  for (const stage of options.skip) {
    if (!STAGES.includes(stage)) throw new Error(`Unknown stage "${stage}" in --skip`);
  }
  return options;
}

async function runCommandLine(argv) {
  const options = parseArguments(argv);
  if (options.command === 'dashboard') {
    await startDashboard();
    return null;
  }
  if (options.command === 'list') {
    console.log((await listProjectNames()).join('\n') || 'No projects configured.');
    return EXIT_PASS;
  }
  if (options.command === 'prune') return pruneCommand(options);
  if (!['run', 'record'].includes(options.command) || !options.project) {
    console.log(USAGE);
    return options.command && options.command !== 'help' ? EXIT_ERROR : EXIT_PASS;
  }
  if (options.level && options.command !== 'run') throw new Error('--level applies to run only');
  const projectConfig = await loadProjectConfig(options.project, { includeSessions: !options.liveAuth });
  const config = options.repo ? { ...projectConfig, repo: options.repo } : projectConfig;
  if (options.liveAuth) {
    if (options.level) throw new Error('--level cannot be combined with --live-auth');
    if (options.command !== 'run' || !config.web?.specs?.live) throw new Error('--live-auth requires run and web.specs.live configuration');
    if (options.skip.has('web')) throw new Error('--live-auth cannot be combined with --skip web');
    config.web.specs = { ...config.web.specs, mode: 'live' };
    options.noBaseline = true;
  }
  return options.command === 'run' ? runProject(config, options) : recordProject(config, options);
}

/** `spotter prune`: delete old artifacts for one project or all of them. */
async function pruneCommand(options) {
  const names = await listProjectNames();
  if (options.project && !names.includes(options.project)) throw new Error(`Unknown project "${options.project}"`);
  const settings = retentionSettings(process.env, { keepRuns: options.keepRuns, keepBaselines: options.keepBaselines }, await loadSavedRetention(spotterHome));
  let total = 0;
  for (const name of options.project ? [options.project] : names) {
    const { removed, skipped } = await pruneProject(projectDirs(name), { ...settings, dryRun: options.dryRun });
    for (const removedPath of removed) console.log(`${options.dryRun ? 'would remove' : 'removed'} ${toHostPath(removedPath)}`);
    if (skipped) console.log(`${name}: ${skipped}`);
    total += removed.length;
  }
  console.log(`${total} item(s) ${options.dryRun ? 'would be removed' : 'removed'}.`);
  return EXIT_PASS;
}

/** `spotter run`: head vs merge base, report written and printed. */
async function runProject(config, options) {
  const plan = options.liveAuth ? { config, skip: new Set(), record: null, hash: 'live' } : resolvePlan(config, options.level);
  log(`plan: ${summarizePlan(plan)}`);
  const runSkip = new Set([...options.skip, ...plan.skip]);
  const startedAt = Date.now();
  const directories = projectDirs(config.name);
  const headRef = options.ref ?? 'HEAD';
  const headSha = await resolveCommit(config.repo, headRef);
  const baseSha = options.noBaseline ? null : await findMergeBase(config.repo, config.baseBranch, headSha);
  const fixtures = config.web?.api && !options.liveAuth ? await loadFixtures(directories.fixtures) : null;
  if (config.web?.api && !fixtures && !options.liveAuth) log(`no fixtures yet — run: spotter record ${config.name}`);

  const runDir = path.join(directories.runs, process.env.SPOTTER_RUN_ID ?? `${timestampForPath()}-${slugify(options.workingTree ? 'working-tree' : headRef)}-${randomUUID().slice(0, 8)}`);
  const workRoot = path.join(directories.work, path.basename(runDir));
  await mkdir(runDir, { recursive: true });

  const activity = createActivity(runDir, { project: config.name, branch: headRef, startedAt: new Date(startedAt).toISOString(), level: plan.record?.name ?? null, plan: summarizePlan(plan) });
  try {
    const changes = baseSha
      ? {
          addedLines: await listAddedLines(config.repo, baseSha, options.workingTree ? null : headSha),
          commits: await listCommitMessages(config.repo, baseSha, headSha),
        }
      : { addedLines: [], commits: [] };
    const sideArguments = { config: plan.config, fixtures, skip: runSkip, workRoot, activity };

    const headPromise = runSide({
      ...sideArguments,
      sha: options.workingTree ? null : headSha,
      sideDir: runDir,
      changes,
      log: (step, state) => { log(`head: ${step} (${state ?? 'started'})`); activity.event('head', step, state); },
    });
    const basePromise = baseSha && (baseSha !== headSha || options.workingTree) ? loadOrRunBase({ ...sideArguments, baseSha, directories, planHash: plan.hash }).catch((error) => {
      log(`base: failed — ${error.message}`);
      activity.event('base', 'base run failed', 'done');
      return { error };
    }) : null;
    const [head, base] = await Promise.all([headPromise, basePromise]);
    await rm(workRoot, { recursive: true, force: true });

    activity.event('run', 'compare findings and screenshots');
    const baseline = assessBaseline({ config: plan.config, skip: options.skip, headStages: head.stages, baseStages: base?.side?.stages, baseSha, headSha, workingTree: !!options.workingTree, cached: !!base?.cached, error: base?.error, liveAuth: !!options.liveAuth });
    const comparison = base?.side && baseline.status !== 'failed'
      ? compareWithBaseline(head.findings, base.side.findings)
      : { newFindings: head.findings, existingFindings: [], fixedFindings: [] };
    for (const category of Object.keys(comparison)) {
      comparison[category] = sortFindings(comparison[category], STAGES).map(withHostPaths);
    }

    const run = {
      project: config.name,
      head: { label: `${options.workingTree ? `${headRef} + working tree` : headRef}${options.liveAuth ? ' (live authentication)' : ''}`, sha: headSha, shortSha: headSha.slice(0, 7), stages: head.stages },
      base: baseSha ? { label: `${config.baseBranch} merge base`, sha: baseSha, shortSha: baseSha.slice(0, 7) } : null,
      fixtures: describeFixtures(fixtures),
      plan: summarizePlan(plan),
      completeness: assessCompleteness({ config: plan.config, skip: options.skip, stages: head.stages, fixtures, baseline, liveAuth: !!options.liveAuth, level: plan.record }),
      comparison,
      visual: await compareScreenshots(path.join(runDir, 'screenshots'), base?.side?.screenshotDir ?? (baseSha === headSha && !options.workingTree ? path.join(runDir, 'screenshots') : null), runDir),
      durationMs: Date.now() - startedAt,
      paths: {
        reportHtml: toHostPath(path.join(runDir, 'report.html')),
        reportJson: toHostPath(path.join(runDir, 'report.json')),
        screenshots: toHostPath(path.join(runDir, 'screenshots')),
        logs: toHostPath(path.join(runDir, 'logs')),
      },
    };
    const markdown = renderMarkdownReport(run);
    await writeFile(path.join(runDir, 'report.md'), markdown);
    await writeFile(path.join(runDir, 'report.html'), renderHtmlReport(run, markdown));
    await writeFile(path.join(runDir, 'report.json'), JSON.stringify(run, null, 2));
    await pointLatestAt(directories.runs, runDir);
    process.stdout.write(markdown);
    const exitCode = run.completeness.status === 'incomplete' ? EXIT_INCOMPLETE : hasFailingFinding(comparison.newFindings) ? EXIT_FINDINGS : EXIT_PASS;
    activity.event('run', 'compare findings and screenshots', 'done');
    activity.finish(exitCode === EXIT_INCOMPLETE ? 'incomplete' : exitCode ? 'fail' : 'pass');
    try {
      const settings = retentionSettings(process.env, {}, await loadSavedRetention(spotterHome));
      if (settings.autoPrune) {
        const { removed } = await pruneProject(directories, settings);
        if (removed.length) log(`pruned ${removed.length} old item(s)`);
      }
    } catch (error) {
      log(`retention skipped: ${error.message}`);
    }
    return exitCode;
  } catch (error) {
    activity.finish('error', error.message);
    throw error;
  }
}

/** The merge base's findings, from cache when the same commit, config and fixtures ran before. */
async function loadOrRunBase({ config, fixtures, skip, workRoot, baseSha, directories, activity, planHash }) {
  const cacheKey = `${baseSha.slice(0, 12)}-${spotterCodeHash()}-${config.configHash}-${fixtures?.hash ?? 'none'}-${[...skip].sort().join('_') || 'all'}-${planHash}`;
  const cacheFile = path.join(directories.baselines, cacheKey, 'side.json');
  const cached = await readCachedSide(cacheFile);
  if (cached) {
    log('base: reusing cached results');
    activity.event('base', 'reusing cached results', 'done');
    await utimes(cacheFile, new Date(), new Date()).catch(() => {});
    return { side: cached, cached: true };
  }
  const base = await runSide({
    config,
    fixtures,
    skip,
    workRoot,
    sha: baseSha,
    sideDir: path.dirname(cacheFile),
    changes: { addedLines: [], commits: [] },
    log: (step, state) => { log(`base: ${step} (${state ?? 'started'})`); activity.event('base', step, state); },
  });
  await writeCachedSide(cacheFile, base);
  return { side: base, cached: false };
}

/** `spotter record`: build <ref>, visit every route against the live API, save responses. */
async function recordProject(config, options) {
  if (!config.web?.api?.recordFrom) throw new Error('`web.api.recordFrom` is not configured for this project');
  const directories = projectDirs(config.name);
  const ref = options.ref ?? config.baseBranch;
  const sha = await resolveCommit(config.repo, ref);
  const previous = await loadFixtures(directories.fixtures);
  const existing = options.merge ? previous : null;
  const entries = { ...(existing?.entries ?? {}) };
  const sessions = Object.fromEntries(Object.entries(existing?.sessions ?? {}).map(([name, responses]) => [name, { ...responses }]));
  const knownBefore = Object.keys(entries).length + Object.values(sessions).reduce((sum, responses) => sum + Object.keys(responses).length, 0);
  // Freeze the page clock exactly as replay will, so date-based requests match.
  const recordedAt = existing?.recordedAt ?? new Date().toISOString();

  const exportDir = path.join(directories.work, `record-${sha.slice(0, 12)}`);
  const logDir = path.join(directories.fixtures, 'logs');
  await mkdir(logDir, { recursive: true });
  await rm(exportDir, { recursive: true, force: true });
  try {
    await exportCommit(config.repo, sha, exportDir);
    const workdir = path.join(exportDir, config.workdir);
    log(`installing ${ref} @ ${sha.slice(0, 7)}`);
    const install = await runStaticStage({ config: { ...config, checks: [] }, workdir, logDir });
    if (!install.installed) throw new Error(`install failed; see ${toHostPath(logDir)}/install.log`);
    log(`recording from ${config.web.api.recordFrom}`);
    const result = await runWebStage({ config, workdir, logDir, screenshotDir: logDir, fixtures: { recordedAt }, mode: 'record', recordedEntries: { entries, sessions } });
    if (!result.summary.built) throw new Error(`build failed; see ${toHostPath(logDir)}/web-build.log`);
  } finally {
    await rm(exportDir, { recursive: true, force: true });
  }

  const recorded = { recordedAt, source: config.web.api.recordFrom, ref, sha, entries, sessions };
  const drift = compareContracts(previous, recorded);
  await writeFile(path.join(directories.fixtures, 'contracts.json'), JSON.stringify(snapshotContracts(recorded), null, 2));
  await writeFile(path.join(directories.fixtures, 'contract-drift.json'), JSON.stringify(drift, null, 2));
  await saveFixtures(directories.fixtures, recorded);
  const responses = [...Object.values(entries), ...Object.values(sessions).flatMap(Object.values)];
  const errorCount = responses.filter((entry) => entry.status >= 400).length;
  console.log(
    `Recorded ${responses.length} API responses (${responses.length - knownBefore} new, ${errorCount} non-2xx) ` +
      `to ${toHostPath(directories.fixtures)}/api.json; clock frozen at ${recordedAt}.`,
  );
  console.log(previous
    ? `API contracts: ${drift.length} changed endpoint/session contracts; see ${toHostPath(directories.fixtures)}/contract-drift.json.`
    : 'API contracts: initial shape snapshot created.');
  return EXIT_PASS;
}

function withHostPaths(finding) {
  return { ...finding, artifacts: finding.artifacts.map(toHostPath) };
}

async function pointLatestAt(runsDir, runDir) {
  const latest = path.join(runsDir, 'latest');
  await rm(latest, { force: true });
  await symlink(path.basename(runDir), latest);
}

const timestampForPath = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const slugify = (text) => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

if (import.meta.url === `file://${process.argv[1]}`) {
  runCommandLine(process.argv.slice(2))
    .then((code) => { if (code !== null) process.exit(code); })
    .catch((error) => {
      process.stderr.write(`spotter: ${error.message}\n`);
      process.exit(EXIT_ERROR);
    });
}
