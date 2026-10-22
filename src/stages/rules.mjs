import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFinding } from '../findings.mjs';
import { matchesAnyGlob } from '../glob.mjs';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Applies the project's text rules and import boundaries.
 * `changes` holds { addedLines, commits } for the branch (paths relative to the repo root);
 * `workdir` is the exported checkout's working directory.
 */
export async function runRulesStage({ config, workdir, changes }) {
  const findings = [];
  const sourceFiles = await listFiles(workdir);
  for (const rule of config.rules.forbiddenText) {
    findings.push(...(await applyForbiddenText({ rule, config, workdir, sourceFiles, changes })));
  }
  for (const boundary of config.rules.importBoundaries) {
    findings.push(...(await applyImportBoundary({ boundary, config, workdir, sourceFiles })));
  }
  return { findings };
}

async function applyForbiddenText({ rule, config, workdir, sourceFiles, changes }) {
  const pattern = new RegExp(rule.pattern, rule.flags ?? 'i');
  const scopes = [rule.in ?? 'added-lines'].flat();
  const hits = [];

  if (scopes.includes('commits')) {
    for (const commit of changes.commits) {
      const match = pattern.exec(commit.message);
      if (match) hits.push({ title: `${rule.message} (commit ${commit.sha.slice(0, 7)}: "${match[0]}")`, key: { commit: commit.sha } });
    }
  }
  if (scopes.includes('added-lines')) {
    for (const added of changes.addedLines) {
      if (rule.glob && !matchesAnyGlob(toWorkdirPath(added.file, config), rule.glob)) continue;
      if (pattern.test(added.text)) hits.push({ title: rule.message, file: added.file, line: added.line, detail: added.text.trim() });
    }
  }
  if (scopes.includes('files')) {
    for (const file of sourceFiles.filter((candidate) => !rule.glob || matchesAnyGlob(candidate, rule.glob))) {
      const lines = (await readFile(path.join(workdir, file), 'utf8')).split('\n');
      lines.forEach((text, index) => {
        if (pattern.test(text)) hits.push({ title: rule.message, file: toRepoPath(file, config), line: index + 1, detail: text.trim() });
      });
    }
  }

  return hits.map((hit) =>
    createFinding({ stage: 'rules', check: rule.id, severity: rule.severity ?? 'medium', ...hit, key: { detail: hit.detail ?? null, ...hit.key } }),
  );
}

/**
 * Flags imports from one slice (a directory under `boundary.root`) into another,
 * unless an `allow` entry ({ from, to }) covers it. `to` may name a slice or a
 * path inside it (`schedule/utils/gameStatusHelper`); `*` matches any slice.
 */
async function applyImportBoundary({ boundary, config, workdir, sourceFiles }) {
  const root = boundary.root.replace(/\/$/, '');
  const findings = [];
  for (const file of sourceFiles.filter((candidate) => candidate.startsWith(`${root}/`))) {
    const sourceSlice = file.slice(root.length + 1).split('/')[0];
    const lines = (await readFile(path.join(workdir, file), 'utf8')).split('\n');
    lines.forEach((text, index) => {
      for (const specifier of findImportSpecifiers(text)) {
        const target = resolveSpecifier(specifier, file, boundary.aliases ?? {});
        if (!target?.startsWith(`${root}/`)) continue;
        const targetPath = target.slice(root.length + 1);
        const targetSlice = targetPath.split('/')[0];
        if (targetSlice === sourceSlice || isImportAllowed(boundary.allow ?? [], sourceSlice, targetPath)) continue;
        findings.push(
          createFinding({
            stage: 'rules',
            check: boundary.id,
            severity: boundary.severity ?? 'medium',
            title: `${boundary.message ?? 'cross-slice import'}: ${sourceSlice} → ${targetSlice}`,
            file: toRepoPath(file, config),
            line: index + 1,
            detail: `import '${specifier}'`,
            key: { specifier: specifier.replace(/\.[jt]sx?$/, '') },
          }),
        );
      }
    });
  }
  return findings;
}

/** Module specifiers imported on one source line (static, side-effect, re-export and dynamic). */
export function findImportSpecifiers(line) {
  const specifiers = [];
  const patterns = [/\bfrom\s*['"]([^'"]+)['"]/g, /^\s*import\s*['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolves an alias or relative specifier to a workdir-relative path without extension; bare packages give null. */
export function resolveSpecifier(specifier, fromFile, aliases) {
  for (const [prefix, replacement] of Object.entries(aliases)) {
    if (specifier.startsWith(prefix)) return path.posix.normalize(replacement + specifier.slice(prefix.length));
  }
  if (specifier.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  return null;
}

function isImportAllowed(allowList, fromSlice, targetPath) {
  const target = targetPath.replace(/\.[jt]sx?$/, '').replace(/\/index$/, '');
  return allowList.some(
    ({ from, to }) =>
      (from === '*' || from === fromSlice) && (to === '*' || target === to || target.startsWith(`${to}/`)),
  );
}

async function listFiles(workdir, directory = '') {
  const entries = await readdir(path.join(workdir, directory), { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) files.push(...(await listFiles(workdir, relativePath)));
    else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

const toRepoPath = (file, config) => path.posix.join(config.workdir, file).replace(/^\.\//, '');
function toWorkdirPath(file, config) {
  if (config.workdir === '.') return file;
  const workdirPrefix = `${config.workdir}/`;
  if (file.startsWith(workdirPrefix)) return file.slice(workdirPrefix.length);
  return `../${file}`;
}
