import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runOrThrow } from './exec.mjs';

const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const git = (repo, args) => runOrThrow(`git -C ${quote(repo)} ${args}`);

/** Resolves a branch, tag or SHA to a full commit SHA. */
export async function resolveCommit(repo, ref) {
  return (await git(repo, `rev-parse --verify --quiet ${quote(`${ref}^{commit}`)}`)).trim();
}

/** The branch-point commit between `baseRef` and `headSha`. */
export async function findMergeBase(repo, baseRef, headSha) {
  return (await git(repo, `merge-base ${quote(baseRef)} ${quote(headSha)}`)).trim();
}

/** Writes the tree of `sha` into `destination` without touching the project's checkout. */
export async function exportCommit(repo, sha, destination) {
  await mkdir(destination, { recursive: true });
  await runOrThrow(`git -C ${quote(repo)} archive ${quote(sha)} | tar -x -C ${quote(destination)}`);
}

/** Copies tracked and untracked-but-not-ignored files from the project's working tree. */
export async function exportWorkingTree(repo, destination) {
  await mkdir(destination, { recursive: true });
  const listed = (await git(repo, 'ls-files -z --cached --others --exclude-standard')).split('\0').filter(Boolean);
  // Tracked files deleted in the working tree are still listed; skip them.
  const present = listed.filter((file) => existsSync(path.join(repo, file)));
  const fileList = path.join(destination, '.spotter-files');
  await writeFile(fileList, present.join('\0'));
  await runOrThrow(
    `tar -C ${quote(repo)} --null -T ${quote(fileList)} -cf - | tar -x -C ${quote(destination)} && rm ${quote(fileList)}`,
  );
}

/**
 * Lines added since `baseSha`, as { file, line, text }. With `headSha` null the
 * comparison is against the working tree, untracked files included.
 */
export async function listAddedLines(repo, baseSha, headSha) {
  const range = headSha ? `${quote(baseSha)} ${quote(headSha)}` : quote(baseSha);
  const diff = await git(repo, `diff --no-color --no-ext-diff -U0 ${range} --`);
  const addedLines = parseAddedLines(diff);
  if (!headSha) {
    const untracked = (await git(repo, 'ls-files -z --others --exclude-standard')).split('\0').filter(Boolean);
    for (const file of untracked) {
      const content = await readFile(path.join(repo, file), 'utf8').catch(() => '');
      content.split('\n').forEach((text, index) => addedLines.push({ file, line: index + 1, text }));
    }
  }
  return addedLines;
}

/** Parses `git diff -U0` output into added lines with their new line numbers. */
export function parseAddedLines(diff) {
  const addedLines = [];
  let file = null;
  let nextLine = 0;
  for (const rawLine of diff.split('\n')) {
    if (rawLine.startsWith('+++ ')) {
      file = rawLine === '+++ /dev/null' ? null : rawLine.slice(4).replace(/^b\//, '');
    } else if (rawLine.startsWith('@@')) {
      const hunk = /\+(\d+)/.exec(rawLine);
      nextLine = hunk ? Number(hunk[1]) : 0;
    } else if (file && rawLine.startsWith('+')) {
      addedLines.push({ file, line: nextLine, text: rawLine.slice(1) });
      nextLine += 1;
    }
  }
  return addedLines;
}

/** Commit messages on the branch since `baseSha`, as { sha, message }. */
export async function listCommitMessages(repo, baseSha, headSha) {
  const log = await git(repo, `log --format=%H%x00%B%x1e ${quote(`${baseSha}..${headSha}`)}`);
  return log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, message = ''] = entry.split('\0');
      return { sha, message: message.trim() };
    });
}
