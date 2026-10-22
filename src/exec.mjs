import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/**
 * Runs a shell command and resolves with its exit code and combined output
 * (never rejects on a non-zero exit). Output is written to `logFile` if given.
 */
export async function runCommand(command, { cwd, env = {}, timeoutMs = DEFAULT_TIMEOUT_MS, logFile } = {}) {
  const startedAt = Date.now();
  const outputChunks = [];
  const exitCode = await new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      outputChunks.push(Buffer.from(`\n[spotter] timed out after ${timeoutMs / 1000}s\n`));
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => outputChunks.push(chunk));
    child.stderr.on('data', (chunk) => outputChunks.push(chunk));
    child.on('error', (error) => {
      outputChunks.push(Buffer.from(String(error)));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
  const output = Buffer.concat(outputChunks).toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  if (logFile) await writeFile(logFile, `$ ${command}\n${output}`);
  return { exitCode, output, durationMs: Date.now() - startedAt };
}

/** Runs a command and returns its stdout, throwing with the output on failure. */
export async function runOrThrow(command, options) {
  const result = await runCommand(command, options);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command}\n${lastLines(result.output, 20)}`);
  }
  return result.output;
}

/** The last `count` non-empty lines of some output. */
export function lastLines(output, count) {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-count)
    .join('\n');
}
