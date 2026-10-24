import { createHash } from 'node:crypto';
import { BROWSERS, isDefaultMatrix, listTargets } from './browsers.mjs';

export const LEVELS = ['low', 'medium', 'high'];

/** Devices every web project adds at high: one WebKit and one Chromium phone. */
export const HIGH_DEVICES = ['iPhone 13', 'Pixel 7'];

/** Every endpoint fault a sweep can inject. High runs all of them. */
export const FAULT_KINDS = ['500', 'delay', 'abort', '401', '403', '429', 'malformed'];
/** Fault kinds when `web.faultInjection.kinds` is not configured (low skips faults). */
export const DEFAULT_FAULT_KINDS = ['500', 'delay'];

/** Wider coverage high would add that is not implemented yet. Listed, never enabled. */
export const UNSUPPORTED_AT_HIGH = [
  { name: 'data edge cases', ticket: 'QA-13', reason: 'not implemented' },
  { name: 'performance budgets', ticket: 'QA-15', reason: 'not implemented' },
];

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));

/** Problems with a raw `levels` block (string messages; [] when valid or absent). */
export function levelProblems(rawConfig) {
  const levels = rawConfig.levels;
  if (levels === undefined) return [];
  if (!isObject(levels) || !onlyKeys(levels, ['default', 'low'])) return ['`levels` must be an object with optional default and low'];
  const problems = [];
  if (levels.default !== undefined && !LEVELS.includes(levels.default)) problems.push('`levels.default` must be low, medium or high');
  else if (levels.default === 'low' && levels.low === undefined) problems.push('`levels.default: low` requires `levels.low`');
  const low = levels.low;
  if (low === undefined) return problems;
  if (!isObject(low) || !onlyKeys(low, ['routes', 'specs'])) return [...problems, '`levels.low` accepts routes and specs'];
  const web = rawConfig.web;
  if (web) {
    const names = (Array.isArray(web.routes) ? web.routes : []).map((route) => (typeof route === 'string' ? route : route?.name));
    if (!Array.isArray(low.routes) || !low.routes.length || new Set(low.routes).size !== low.routes.length
      || low.routes.some((name) => typeof name !== 'string' || !names.includes(name))) {
      problems.push('`levels.low.routes` must list configured web route names');
    }
  } else if (low.routes !== undefined) problems.push('`levels.low.routes` must list configured web route names');
  const specs = low.specs;
  if (specs !== undefined && (!isObject(specs) || !onlyKeys(specs, ['grep']) || typeof specs.grep !== 'string' || !specs.grep.trim() || !web?.specs)) {
    problems.push('`levels.low.specs` needs a string grep and requires `web.specs`');
  }
  return problems;
}

/** Normalized `levels`: null when the block is absent. */
export function normalizeLevels(rawLevels) {
  if (!rawLevels) return null;
  return {
    default: rawLevels.default ?? null,
    low: rawLevels.low ? { routes: rawLevels.low.routes ?? [], specs: rawLevels.low.specs ?? null } : null,
  };
}

/** The execution plan for one run. Throws Error on an unknown or unconfigured level. */
export function resolvePlan(config, selected) {
  if (selected && !LEVELS.includes(selected)) throw new Error(`Unknown level "${selected}"; use low, medium or high`);
  const name = selected || config.levels?.default || null;
  const source = selected ? 'selected' : 'default';
  if (name === 'low' && !config.levels?.low) throw new Error(`Level low is not configured; add levels.low to projects/${config.name}.yml`);
  const skip = new Set();
  const exclusions = [];
  let effective = config;
  if (name === 'low') effective = narrowToLow(config, skip, exclusions);
  else if (name === 'high' && config.web) {
    const union = (base, extra) => [...new Set([...base, ...extra])];
    effective = { ...config, web: { ...config.web, browsers: union(config.web.browsers, BROWSERS), devices: union(config.web.devices, HIGH_DEVICES) } };
    if (config.web.faultInjection) effective.web.faultInjection = { ...config.web.faultInjection, kinds: FAULT_KINDS };
  }
  const record = name && { name, source, exclusions, unsupported: name === 'high' ? UNSUPPORTED_AT_HIGH : [] };
  const hash = createHash('sha1').update(JSON.stringify({ name, skip: [...skip].sort(), config: effective })).digest('hex').slice(0, 10);
  return { config: effective, skip, record, hash };
}

function narrowToLow(config, skip, exclusions) {
  const required = config.coverage?.required ?? [];
  const exclude = (name, kind) => exclusions.push({ name, kind, reason: 'excluded at level low' });
  const low = config.levels.low;
  const checks = (config.checks ?? []).filter((check) => required.includes(check.name) || (exclude(check.name, 'check'), false));
  if (!required.includes('rules')) {
    skip.add('rules');
    exclude('rules', 'stage');
  }
  skip.add('config');
  exclude('config', 'stage');
  const narrowed = { ...config, checks };
  const web = config.web;
  if (!web) return narrowed;

  const keep = (items, kind, nameOf) => items.filter((item, index) => index === 0 || (exclude(nameOf(item), kind), false));
  const routes = (web.routes ?? []).filter((route) => low.routes.includes(route.name) || (exclude(route.name, 'route'), false));
  const viewports = keep(web.viewports ?? [], 'viewport', (viewport) => String(viewport?.width ?? viewport));
  const colorSchemes = keep(web.colorSchemes ?? [], 'colorScheme', (scheme) => scheme);
  if (web.faultInjection) exclude('fault visits', 'faults');
  const { specs, ...rest } = web;
  web.browsers.slice(1).forEach((name) => exclude(name, 'browser'));
  web.devices.forEach((name) => exclude(name, 'device'));
  const narrowedWeb = { ...rest, routes, viewports, colorSchemes, browsers: web.browsers.slice(0, 1), devices: [], faultInjection: null };
  let specsChanged = false;
  if (low.specs) {
    narrowedWeb.specs = { ...specs, grep: low.specs.grep };
    specsChanged = true;
  } else if (required.includes('specs')) narrowedWeb.specs = specs;
  else if (specs) {
    exclude('specs', 'specs');
    specsChanged = true;
  }
  const coverage = { ...config.coverage };
  if (specsChanged && coverage.minSpecs) {
    coverage.minSpecs = null;
    exclude('minSpecs', 'coverage');
  }
  return { ...narrowed, web: narrowedWeb, coverage };
}

/** One line shared by CLI, activity, dashboard preview and reports. */
export function summarizePlan({ config, skip, record }) {
  const parts = [record ? `level ${record.name} (${record.source})` : 'no level'];
  parts.push(`${(config.checks ?? []).length} checks`, skip.has('rules') ? 'no rules' : 'rules');
  const web = config.web;
  if (web) {
    parts.push(`${web.routes.length} routes × ${web.viewports.length} viewports × ${web.colorSchemes.length} schemes × ${web.sessions?.length ?? 1} sessions${web.faultInjection ? ` + fault visits${faultKindsNote(web.faultInjection.kinds)}` : ''}`);
    if (!isDefaultMatrix(web)) parts.push(`matrix ${listTargets(web).map((t) => t.label).join(', ')}`);
    if (web.specs) parts.push(web.specs.grep ? `specs (grep ${web.specs.grep})` : 'specs');
  }
  if (record?.exclusions.length) parts.push(`excluded: ${record.exclusions.map((item) => item.name).join(', ')}`);
  if (record?.unsupported.length) parts.push(`unsupported: ${record.unsupported.map((item) => `${item.name} (${item.ticket})`).join(', ')}`);
  return parts.join(' · ');
}

const faultKindsNote = (kinds) => (kinds && kinds.join() !== DEFAULT_FAULT_KINDS.join() ? ` (${kinds.join(', ')})` : '');
