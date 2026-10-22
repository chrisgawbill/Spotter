#!/usr/bin/env node
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listProjectNames, loadProjectConfig } from './config.mjs';
import { compareWithBaseline, hasFailingFinding, sortFindings } from './findings.mjs';
import { loadFixtures, saveFixtures } from './fixtures.mjs';
import { exportCommit, findMergeBase, listAddedLines, listCommitMessages, resolveCommit } from './git.mjs';
import { projectDirs, spotterCodeHash, toHostPath } from './paths.mjs';
import { renderMarkdownReport } from './report.mjs';
import { renderHtmlReport } from './htmlReport.mjs';
import { compareScreenshots } from './visual.mjs';
import { readCachedSide, runSide, STAGES, writeCachedSide } from './runner.mjs';
import { runStaticStage } from './stages/static.mjs';
import { runWebStage } from './stages/web.mjs';

const USAGE = `Spotter — automatic QA that reports what is new on a branch.

  spotter run <project> [--ref <ref>] [--repo <path>] [--working-tree] [--no-baseline] [--skip static,rules,web]
      Check <ref> (default: the checkout's HEAD) against its merge base with
      the base branch. --repo checks another clone or worktree of the project;
      --working-tree includes uncommitted changes. Prints report.md; exit 1 if anything new is high
      or medium, 2 if Spotter itself failed.
  spotter record <project> [--ref <ref>] [--repo <path>] [--merge]
      Visit every route against the live API and store its responses as the
      fixtures runs replay. --merge keeps existing entries and adds new ones.
  spotter list
      Configured projects.`;

const EXIT_PASS = 0;
const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;

const log = (message) => process.stderr.write(`[spotter] ${message}\n`);

/** Parses `<command> <project> --flag value --switch` into a plain object. */
export function parseArguments(argv) {
  const [command, project, ...flags] = argv;
  const options = { command, project, skip: new Set() };
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === '--ref') options.ref = flags[++index];
    else if (flag === '--repo') options.repo = path.resolve(flags[++index]);
    else if (flag === '--working-tree') options.workingTree = true;
    else if (flag === '--no-baseline') options.noBaseline = true;
    else if (flag === '--merge') options.merge = true;
    else if (flag === '--skip') {
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
  if (options.command === 'list') {
    console.log((await listProjectNames()).join('\n') || 'No projects configured.');
    return EXIT_PASS;
  }
  if (!['run', 'record'].includes(options.command) || !options.project) {
    console.log(USAGE);
    return options.command && options.command !== 'help' ? EXIT_ERROR : EXIT_PASS;
  }
  const projectConfig = await loadProjectConfig(options.project);
  const config = options.repo ? { ...projectConfig, repo: options.repo } : projectConfig;
  return options.command === 'run' ? runProject(config, options) : recordProject(config, options);
}

/** `spotter run`: head vs merge base, report written and printed. */
async function runProject(config, options) {
  const startedAt = Date.now();
  const directories = projectDirs(config.name);
  const headRef = options.ref ?? 'HEAD';
  const headSha = await resolveCommit(config.repo, headRef);
  const baseSha = options.noBaseline ? null : await findMergeBase(config.repo, config.baseBranch, headSha);
  const fixtures = config.web?.api ? await loadFixtures(directories.fixtures) : null;
  if (config.web?.api && !fixtures) log(`no fixtures yet — run: spotter record ${config.name}`);

  const runDir = path.join(directories.runs, `${timestampForPath()}-${slugify(options.workingTree ? 'working-tree' : headRef)}`);
  const workRoot = path.join(directories.work, path.basename(runDir));
  await mkdir(runDir, { recursive: true });

  const changes = baseSha
    ? {
        addedLines: await listAddedLines(config.repo, baseSha, options.workingTree ? null : headSha),
        commits: await listCommitMessages(config.repo, baseSha, headSha),
      }
    : { addedLines: [], commits: [] };
  const sideArguments = { config, fixtures, skip: options.skip, workRoot };

  const headPromise = runSide({
    ...sideArguments,
    sha: options.workingTree ? null : headSha,
    sideDir: runDir,
    changes,
    log: (step) => log(`head: ${step}`),
  });
  const basePromise = baseSha && (baseSha !== headSha || options.workingTree) ? loadOrRunBase({ ...sideArguments, baseSha, directories }) : null;
  const [head, base] = await Promise.all([headPromise, basePromise]);
  await rm(workRoot, { recursive: true, force: true });

  const comparison = base
    ? compareWithBaseline(head.findings, base.findings)
    : { newFindings: head.findings, existingFindings: [], fixedFindings: [] };
  for (const category of Object.keys(comparison)) {
    comparison[category] = sortFindings(comparison[category], STAGES).map(withHostPaths);
  }

  const run = {
    project: config.name,
    head: { label: options.workingTree ? `${headRef} + working tree` : headRef, sha: headSha, shortSha: headSha.slice(0, 7), stages: head.stages },
    base: baseSha ? { label: `${config.baseBranch} merge base`, sha: baseSha, shortSha: baseSha.slice(0, 7) } : null,
    fixtures: fixtures ? { recordedAt: fixtures.recordedAt, hash: fixtures.hash } : null,
    comparison,
    visual: await compareScreenshots(path.join(runDir, 'screenshots'), base?.screenshotDir ?? (baseSha === headSha && !options.workingTree ? path.join(runDir, 'screenshots') : null), runDir),
    durationMs: Date.now() - startedAt,
    paths: {
      reportHtml: toHostPath(path.join(runDir, 'report.html')),
      reportJson: toHostPath(path.join(runDir, 'report.json')),
      screenshots: toHostPath(path.join(runDir, 'screenshots')),
      logs: toHostPath(path.join(runDir, 'logs')),
    },
  };
  const markdown = renderMarkdownReport(run);
  await writeFile(path.join(runDir, 'report.json'), JSON.stringify(run, null, 2));
  await writeFile(path.join(runDir, 'report.md'), markdown);
  await writeFile(path.join(runDir, 'report.html'), renderHtmlReport(run, markdown));
  await pointLatestAt(directories.runs, runDir);
  process.stdout.write(markdown);
  return hasFailingFinding(comparison.newFindings) ? EXIT_FINDINGS : EXIT_PASS;
}

/** The merge base's findings, from cache when the same commit, config and fixtures ran before. */
async function loadOrRunBase({ config, fixtures, skip, workRoot, baseSha, directories }) {
  const cacheKey = `${baseSha.slice(0, 12)}-${spotterCodeHash()}-${config.configHash}-${fixtures?.hash ?? 'none'}-${[...skip].sort().join('_') || 'all'}`;
  const cacheFile = path.join(directories.baselines, cacheKey, 'side.json');
  const cached = await readCachedSide(cacheFile);
  if (cached) {
    log('base: reusing cached results');
    return cached;
  }
  const base = await runSide({
    config,
    fixtures,
    skip,
    workRoot,
    sha: baseSha,
    sideDir: path.dirname(cacheFile),
    changes: { addedLines: [], commits: [] },
    log: (step) => log(`base: ${step}`),
  });
  await writeCachedSide(cacheFile, base);
  return base;
}

/** `spotter record`: build <ref>, visit every route against the live API, save responses. */
async function recordProject(config, options) {
  if (!config.web?.api?.recordFrom) throw new Error('`web.api.recordFrom` is not configured for this project');
  const directories = projectDirs(config.name);
  const ref = options.ref ?? config.baseBranch;
  const sha = await resolveCommit(config.repo, ref);
  const existing = options.merge ? await loadFixtures(directories.fixtures) : null;
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

  await saveFixtures(directories.fixtures, { recordedAt, source: config.web.api.recordFrom, ref, sha, entries, sessions });
  const responses = [...Object.values(entries), ...Object.values(sessions).flatMap(Object.values)];
  const errorCount = responses.filter((entry) => entry.status >= 400).length;
  console.log(
    `Recorded ${responses.length} API responses (${responses.length - knownBefore} new, ${errorCount} non-2xx) ` +
      `to ${toHostPath(directories.fixtures)}/api.json; clock frozen at ${recordedAt}.`,
  );
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
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`spotter: ${error.message}\n`);
      process.exit(EXIT_ERROR);
    });
}
