import { spawn } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { toHostPath } from './paths.mjs';

/**
 * Starts `run` with bash in its own process group (cwd, env = process.env), output appended
 * to logFile, and resolves once GET readyUrl answers 200–399 (polled every 250 ms, each poll
 * with a 2 s abort). Rejects, after stopping the group, when the command exits first or
 * timeoutMs passes. While running, SIGINT/SIGTERM stop the group and exit the process
 * (130 / 143). After the group is gone the optional `stop` command runs with bash in cwd
 * (its failure is reported on stderr, never thrown).
 */
export async function startBackend({ run, readyUrl, timeoutMs, stop: stopCommand = null, cwd, logFile }) {
  const fd = openSync(logFile, 'a');
  const child = spawn('bash', ['-c', run], { cwd, detached: true, stdio: ['ignore', fd, fd] });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  let exitCode;
  exited.then((code) => { exitCode = code; });
  const killGroup = (signal) => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };

  const runStopCommand = async () => {
    writeSync(fd, `\n[spotter] stop: ${stopCommand}\n`);
    const stopper = spawn('bash', ['-c', stopCommand], { cwd, detached: true, stdio: ['ignore', fd, fd] });
    const result = await Promise.race([
      new Promise((resolve) => stopper.once('exit', (code) => resolve({ code })).once('error', () => resolve({ code: 1 }))),
      sleep(120_000, null, { ref: false }),
    ]);
    if (!result) {
      try { process.kill(-stopper.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      process.stderr.write(`[spotter] backend stop command did not finish within 120s; see ${toHostPath(logFile)}\n`);
    } else if (result.code !== 0) process.stderr.write(`[spotter] backend stop command exited with code ${result.code}; see ${toHostPath(logFile)}\n`);
  };

  let stopping = null;
  const stop = () => stopping ??= (async () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    killGroup('SIGTERM');
    await Promise.race([exited, sleep(5000, null, { ref: false })]);
    killGroup('SIGKILL'); // also reaps any member that outlived the shell or ignored SIGTERM
    if (typeof stopCommand === 'string') await runStopCommand();
    closeSync(fd);
  })();
  const interrupt = (code) => () => stop().finally(() => process.exit(code));
  const onSigint = interrupt(130);
  const onSigterm = interrupt(143);
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  try {
    await new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (exitCode !== undefined) throw new Error(`backend exited with code ${exitCode} before ${readyUrl} was ready`);
      if (Date.now() >= deadline) throw new Error(`backend not ready at ${readyUrl} after ${timeoutMs / 1000}s`);
      const response = await fetch(readyUrl, { redirect: 'manual', signal: AbortSignal.timeout(2000) }).catch(() => null);
      response?.body?.cancel().catch(() => {});
      if (response && response.status >= 200 && response.status < 400) break;
      await sleep(250);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}
