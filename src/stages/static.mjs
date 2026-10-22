import path from 'node:path';
import { createFinding } from '../findings.mjs';
import { runCommand } from '../exec.mjs';
import { parsers } from '../parsers/index.mjs';

/**
 * Installs dependencies, then runs each configured check and turns its output
 * into findings. Returns { findings, summary, installed }; when install fails
 * nothing else can run, so `installed` is false.
 */
export async function runStaticStage({ config, workdir, logDir }) {
  const findings = [];
  const summary = [];

  if (config.install) {
    const install = await runCommand(config.install, { cwd: workdir, logFile: path.join(logDir, 'install.log') });
    if (install.exitCode !== 0) {
      const [failure] = parsers.generic(install);
      findings.push(
        createFinding({
          stage: 'static',
          check: 'install',
          severity: 'high',
          title: `dependency install failed (${failure.title})`,
          detail: failure.detail,
          repro: `cd ${config.workdir} && ${config.install}`,
        }),
      );
      summary.push({ name: 'install', status: 'FAIL' });
      return { findings, summary, installed: false };
    }
  }

  for (const check of config.checks) {
    const checkFindings = await runCheck({ check, config, workdir, logDir });
    findings.push(...checkFindings);
    summary.push({ name: check.name, status: checkFindings.length ? 'FAIL' : 'PASS', count: checkFindings.length });
  }
  return { findings, summary, installed: true };
}

async function runCheck({ check, config, workdir, logDir }) {
  const reportFile = path.join(logDir, `${check.name}.report.json`);
  const command = check.run.replaceAll('{output}', reportFile);
  const result = await runCommand(command, {
    cwd: workdir,
    env: check.env,
    timeoutMs: check.timeoutMs,
    logFile: path.join(logDir, `${check.name}.log`),
  });
  const parse = parsers[check.parser] ?? parsers.generic;
  let parsed = parse({ ...result, reportFile, cwd: workdir });
  // A parser that understands nothing in a failed run must not hide the failure.
  if (result.exitCode !== 0 && parsed.length === 0) parsed = parsers.generic(result);

  const repro = `cd ${config.workdir} && ${check.repro ?? check.run}`;
  return parsed.map((item) =>
    createFinding({
      stage: 'static',
      check: check.name,
      severity: check.severity,
      title: item.title,
      file: item.file ? path.posix.join(config.workdir, item.file).replace(/^\.\//, '') : null,
      line: item.line,
      detail: item.detail,
      repro,
    }),
  );
}
