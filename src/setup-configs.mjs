import { readdir, readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { projectText } from './project-options.mjs';

export function mergeSettings(detected, explicit) {
  if (!explicit || typeof explicit !== 'object' || Array.isArray(explicit)) return explicit;
  const result = { ...detected };
  for (const [key, value] of Object.entries(explicit)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeSettings(detected?.[key], value) : value;
  }
  return result;
}

export async function existingSettings(configsDir, repo, folder) {
  const matches = [];
  for (const file of (await readdir(configsDir).catch(() => [])).filter((file) => /^[A-Za-z0-9_-]+\.yml$/.test(file))) {
    const full = path.join(configsDir, file);
    const info = await lstat(full);
    if (!info.isFile() || info.size > 262144) continue;
    try {
      const source = await readFile(full, 'utf8');
      const config = YAML.parse(source);
      if (!config?.repo || await realpath(config.repo) !== repo) continue;
      if (await realpath(path.resolve(config.repo, config.workdir ?? '.')) !== folder) continue;
      matches.push({ name: file.slice(0, -4), config, source });
    } catch { /* Other projects and invalid configs are not setup templates. */ }
  }
  return matches;
}

export async function projectSettings(repo, folder) {
  for (const directory of [...new Set([folder, repo])]) for (const file of ['spotter.yml', '.spotter.yml', '.spotter/config.yml']) {
    const source = await projectText(directory, file);
    if (!source) continue;
    const config = YAML.parse(source);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${file} must contain a Spotter configuration mapping`);
    if (directory !== folder && path.resolve(directory, config.workdir ?? '.') !== folder) continue;
    // Repository locations belong to the server, not a portable project file.
    return { config: { ...config, repo, workdir: path.relative(repo, folder) || '.' }, source: null, evidence: path.relative(repo, path.join(directory, file)) };
  }
  return null;
}
