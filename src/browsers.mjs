// Pure: no playwright import, so host unit tests (Node 18) can load it.

export const BROWSERS = ['chromium', 'firefox', 'webkit'];

/** The case that keeps legacy screenshot names, `where` text and fingerprints. */
export const DEFAULT_TARGET_ID = 'chromium';

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Matrix cases for a normalized web config: browsers first, then devices. The first is the primary case. */
export function listTargets(web) {
  return [
    ...web.browsers.map((name) => ({ id: name, browser: name, device: null, label: name })),
    ...web.devices.map((name) => ({ id: slug(name), browser: null, device: name, label: name })),
  ];
}

/** True for the legacy Chromium-only matrix. */
export function isDefaultMatrix(web) {
  return web.browsers.length === 1 && web.browsers[0] === DEFAULT_TARGET_ID && !web.devices.length;
}

/** Configured page visits: browsers × routes × viewports × schemes × sessions, plus devices at their own viewport. */
export function countPageVisits(web) {
  const perViewport = web.routes.length * web.colorSchemes.length * web.sessions.length;
  if (web.sampleSecondary) {
    return web.viewports.length * perViewport + (web.browsers.length + web.devices.length - 1) * web.routes.length * web.sessions.length;
  }
  return web.browsers.length * web.viewports.length * perViewport + web.devices.length * perViewport;
}

/** Problems with raw `browsers`/`devices` lists at `where` (e.g. `web`); [] when valid or absent. */
export function matrixProblems(raw, where) {
  const problems = [];
  const { browsers, devices } = raw;
  if (browsers !== undefined && (!Array.isArray(browsers) || !browsers.length || new Set(browsers).size !== browsers.length
    || browsers.some((name) => !BROWSERS.includes(name)))) {
    problems.push(`\`${where}.browsers\` must list unique browsers from chromium, firefox and webkit`);
  }
  if (devices !== undefined && (!Array.isArray(devices) || devices.some((name) => typeof name !== 'string' || !slug(name))
    || new Set(devices.map((name) => typeof name === 'string' && slug(name))).size !== devices.length)) {
    problems.push(`\`${where}.devices\` must list unique Playwright device names such as "iPhone 13"`);
  }
  return problems;
}
