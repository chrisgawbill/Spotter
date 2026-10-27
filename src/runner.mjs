import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareWithInference, inferWebSettings } from './config-drift.mjs';
import { dedupeFindings } from './findings.mjs';
import { exportCommit, exportWorkingTree } from './git.mjs';
import { runRulesStage } from './stages/rules.mjs';
import { runStaticStage } from './stages/static.mjs';
import { runWebStage } from './stages/web.mjs';

export const STAGES = ['static', 'rules', 'web', 'config'];

/**
 * Runs every enabled stage on one side of the comparison (the branch head or
 * its merge base) in a fresh export. `sha` null means the working tree.
 * Returns { findings, stages } where `stages` maps stage name to its summary.
 */
export async function runSide({ config, sha, sideDir, workRoot, fixtures, changes, skip, timingGate, log }) {
  const exportDir = path.join(workRoot, sha ? sha.slice(0, 12) : 'working-tree');
  const workdir = path.join(exportDir, config.workdir);
  const logDir = path.join(sideDir, 'logs');
  await mkdir(logDir, { recursive: true });
  await rm(exportDir, { recursive: true, force: true });
  log('export');
  if (sha) await exportCommit(config.repo, sha, exportDir);
  else await exportWorkingTree(config.repo, exportDir);

  log('export', 'done');
  const findings = [];
  const stages = {};
  try {
    if (config.web && config.web.specs?.mode !== 'live') {
      if (skip.has('config')) stages.config = 'skipped';
      else {
        log('config inference');
        try {
          const drift = compareWithInference(config.web, await inferWebSettings(exportDir, workdir));
          findings.push(...drift);
          stages.config = { missing: drift.length };
        } catch (error) {
          stages.config = { error: error.message };
        }
        log('config inference', 'done');
      }
    }

    log('static checks');
    if (skip.has('static')) stages.static = 'skipped';
    const staticResult = await runStaticStage({ config: skip.has('static') ? { ...config, checks: [] } : config, workdir, logDir, log });
    findings.push(...staticResult.findings);
    log('static checks', 'done');
    if (!skip.has('static')) stages.static = staticResult.summary;

    if (skip.has('rules')) stages.rules = 'skipped';
    else {
      log('rules');
      const rulesResult = await runRulesStage({ config, workdir, changes });
      findings.push(...rulesResult.findings);
      log('rules', 'done');
      stages.rules = { ruleCount: config.rules.forbiddenText.length, boundaryCount: config.rules.importBoundaries.length };
    }

    if (!config.web || skip.has('web') || !staticResult.installed) stages.web = 'skipped';
    else {
      log(`web sweep (${config.web.routes.length} routes)`);
      const webResult = await runWebStage({ config, workdir, logDir, screenshotDir: path.join(sideDir, 'screenshots'), fixtures, timingGate, log });
      findings.push(...webResult.findings);
      log(`web sweep (${config.web.routes.length} routes)`, 'done');
      stages.web = webResult.summary;
    }
  } finally {
    timingGate?.done();
    await rm(exportDir, { recursive: true, force: true });
  }
  return { findings: dedupeFindings(findings), stages, screenshotDir: path.join(sideDir, 'screenshots') };
}

/** Reads a cached base-side result, or null. */
export async function readCachedSide(file) {
  const raw = await readFile(file, 'utf8').catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

/** Stores a base-side result for reuse by later runs on the same merge base. */
export async function writeCachedSide(file, side) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(side));
}
