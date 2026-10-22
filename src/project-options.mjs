import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Bounded reads, confined to the selected checkout. Private env/state files are never scanned. */
export async function projectText(folder, file) {
  const full = await realpath(path.join(folder, file)).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!full || !full.startsWith(`${folder}${path.sep}`) || (await stat(full)).size > 1_048_576) return '';
  return readFile(full, 'utf8');
}

export async function discoverOptions(folder, files, discovered) {
  const web = {};
  const evidence = {};
  const notes = [];
  const facts = discovered.evidence;
  for (const file of files.filter((name) => /(?:^|\/)\.env(?:\.[\w-]+)?\.(?:example|sample|template)$/.test(name))) {
    const source = await projectText(folder, file);
    for (const api of facts.api) if (!api.urls.length) {
      const line = source.split('\n').find((line) => line.startsWith(`${api.envVar}=`));
      if (!line) continue;
      const value = line.slice(api.envVar.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) { api.urls.push(url.href.replace(/\/$/, '')); api.file += ` and ${file}`; } } catch { /* Not a literal public URL. */ }
    }
  }
  if (facts.api.length === 1) {
    const api = facts.api[0];
    web.api = { envVar: api.envVar };
    if (api.urls.length === 1) web.api.recordFrom = api.urls[0];
    evidence['web.api'] = `${api.file}: ${api.envVar}${api.urls.length === 1 ? ' and a literal API URL fallback; verify the recording target' : '; supply the recording URL'}`;
  } else if (facts.api.length > 1) notes.push(`Multiple API variables found (${facts.api.map((item) => item.envVar).join(', ')}); select the API to record.`);
  const themes = [...new Set(facts.themeKeys.map((item) => item.key))];
  if (themes.length === 1) {
    web.colorSchemeStorage = { light: { [themes[0]]: 'light' }, dark: { [themes[0]]: 'dark' } };
    evidence['web.colorSchemeStorage'] = `${facts.themeKeys[0].file}: localStorage key and light/dark values; review inferred theme storage`;
  }
  if (facts.errorText.length) {
    web.errorText = [...new Set(facts.errorText.map((item) => item.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))];
    evidence['web.errorText'] = `Inferred failure indicators from literal error/fallback UI text in ${[...new Set(facts.errorText.map((item) => item.file))].join(', ')}`;
  }
  if (facts.retryDelays.length) {
    const retry = facts.retryDelays.reduce((best, item) => item.values.reduce((a, b) => a + b, 0) > best.values.reduce((a, b) => a + b, 0) ? item : best);
    const backoff = retry.values.reduce((a, b) => a + b, 0);
    web.settleMs = Math.max(400, backoff + 1000);
    web.faultInjection = { delayMs: 2000, timeoutMs: Math.max(5000, backoff + (retry.values.length + 1) * 2000 + 5000) };
    evidence['web.settleMs'] = `${retry.file}: retry backoff totals ${backoff}ms; inferred settling budget, review at runtime`;
    evidence['web.faultInjection'] = `${retry.file}: inferred delayed-retry budget; default loading selector still needs review`;
  }
  if (facts.loadingSelectors.length) {
    web.faultInjection = { ...web.faultInjection, loadingSelector: ['[aria-busy="true"]', '[role="progressbar"]', ...new Set(facts.loadingSelectors.map((item) => item.value))].join(', ') };
    evidence['web.faultInjection'] = `${evidence['web.faultInjection'] ?? 'Default fault budgets'}; inferred stable loading classes from ${[...new Set(facts.loadingSelectors.map((item) => item.file))].join(', ')}`;
  }
  const widths = new Set([375, 1280]);
  const specs = [];
  for (const file of files.filter((file) => /\.(css|scss|sass|less)$/.test(file) || /(?:\.(?:spec|test)\.[cm]?[jt]sx?|playwright\.config\.[cm]?[jt]s)$/.test(file)).slice(0, 500)) {
    const source = await projectText(folder, file);
    if (/\.(css|scss|sass|less)$/.test(file)) {
      for (const media of source.matchAll(/@media[^{}]+/g)) for (const match of media[0].matchAll(/(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?)(px|em|rem)/g)) {
        const width = Math.round(Number(match[1]) * (match[2] === 'px' ? 1 : 16));
        if (width >= 320 && width <= 1920) widths.add(width);
      }
    }
    if (/\.(?:spec|test)\./.test(file) && source.includes('SPOTTER_TEST_MODULE')) {
      if (/\.live\.|SPOTTER_LIVE_AUTH|process\.env\.[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|CREDENTIAL)/i.test(file + '\n' + source)) notes.push(`${file}: live/credential-dependent spec found; configure web.specs.live explicitly.`);
      else specs.push(file);
    }
  }
  if (widths.size > 2) {
    const chosen = new Set([375, 1280]);
    if (widths.has(768)) chosen.add(768);
    const remaining = [...widths].filter((width) => !chosen.has(width)).sort((a, b) => a - b);
    const slots = 8 - chosen.size;
    for (let index = 0; index < Math.min(slots, remaining.length); index++) chosen.add(remaining[Math.round(index * (remaining.length - 1) / Math.max(1, Math.min(slots, remaining.length) - 1))]);
    web.viewports = [...chosen].sort((a, b) => a - b);
    evidence['web.viewports'] = 'CSS media-query breakpoints plus mobile/desktop defaults (em/rem assume 16px); review viewport coverage';
    if (widths.size > 8) notes.push('More than eight responsive widths found; viewport suggestions are capped at eight.');
  }
  if (specs.length) {
    web.specs = { files: specs };
    evidence['web.specs'] = 'Project-owned specs importing SPOTTER_TEST_MODULE; review required fixture/build setup';
  }
  if (facts.playwright.viewports.length) {
    web.viewports = [...new Map(facts.playwright.viewports.map((value) => [JSON.stringify(value), value])).values()];
    evidence['web.viewports'] = 'Literal viewport dimensions from Playwright configuration';
  }
  if (facts.playwright.colorSchemes.length) {
    web.colorSchemes = [...new Set(facts.playwright.colorSchemes)];
    evidence['web.colorSchemes'] = 'Literal color schemes from Playwright configuration';
  }
  if (facts.playwright.pageTimeoutMs) {
    web.pageTimeoutMs = facts.playwright.pageTimeoutMs;
    evidence['web.pageTimeoutMs'] = 'Literal navigationTimeout from Playwright configuration';
  }
  // Use literal links only when they match a known router path; never invent IDs.
  const patterns = discovered.patterns;
  const samples = [];
  for (const item of facts.routeSamples) {
    const candidate = item.path.replace(/^#/, '');
    const pathname = candidate.split(/[?#]/)[0];
    if (/[?&](?:token|password|secret|code|session)=/i.test(candidate)) continue;
    const matches = patterns.some((pattern) => {
      const expression = pattern.split('/').map((part) => part.startsWith(':') || /^\[.+\]$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
      return new RegExp(`^${expression}$`).test(pathname);
    });
    if (matches) samples.push({ name: `linked-${samples.length + 1}`, path: discovered.routes[0]?.path.startsWith('#') ? `#${candidate}` : candidate });
  }
  if (samples.length) { web.routes = [...discovered.routes, ...samples].filter((route, index, all) => all.findIndex((other) => other.path === route.path) === index); evidence['web.routes'] = 'Router definitions plus literal navigation links containing real route/query values'; }
  return { web, evidence, notes };
}
