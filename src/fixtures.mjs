import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SEEDS } from './backend-discovery.mjs';
import { redactSecrets } from './sessions.mjs';

const FIXTURE_FILE = 'api.json';
const TEXT_CONTENT_TYPE = /json|text|javascript|xml|svg/;

/** Identifies a request independently of query-parameter order: `GET /path?a=1&b=2`. */
export function requestKey(method, url) {
  const { pathname, searchParams } = new URL(url);
  const sortedQuery = [...searchParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  return `${method.toUpperCase()} ${pathname}${sortedQuery ? `?${sortedQuery}` : ''}`;
}

/** `/api` matches `/api` and `/api/...`, never `/apix`. */
export function matchesApiPath(pathname, apiPaths) {
  return apiPaths.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Predicate for context.route: the fake API origin, or an app-origin path under web.api.paths. */
/** Whether `web.api.expectedStatuses` lists this replayed response: method, whole path regex and status. */
export function isExpectedStatus(expectedStatuses = [], method, pathname, status) {
  return expectedStatuses.some(({ request, status: statuses }) => {
    const [expectedMethod, pattern] = request.split(' ');
    return expectedMethod === method && [statuses].flat().includes(status) && new RegExp(`^(?:${pattern})$`).test(pathname);
  });
}

export function apiRequestMatcher({ fakeOrigin, apiPaths = [], appOrigin }) {
  const fakeApiOrigin = new URL(fakeOrigin).origin;
  return (url) => url.origin === fakeApiOrigin || (url.origin === appOrigin && matchesApiPath(url.pathname, apiPaths));
}

/**
 * Headers forwarded to recordFrom for one session: web.api.headers overlaid with
 * session.apiHeaders, names lowercased, ${NAME} resolved from env. `secrets` lists every
 * resolved value that contained a ${...} reference. Throws when a referenced variable is unset or empty.
 */
export function recordingHeaders(api, session, env = process.env) {
  const merged = {};
  for (const [name, value] of Object.entries({ ...api.headers, ...session.apiHeaders })) merged[name.toLowerCase()] = value;
  const headers = {};
  const secrets = [];
  for (const [name, template] of Object.entries(merged)) {
    headers[name] = template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, variable) => {
      if (!env[variable]) throw new Error(`Recording header ${name} needs environment variable ${variable}`);
      return env[variable];
    });
    if (headers[name] !== template) secrets.push(headers[name]);
  }
  return { headers, secrets };
}

/** Loads a project's recorded fixtures, or null when none have been recorded. */
export async function loadFixtures(fixturesDir) {
  const raw = await readFile(path.join(fixturesDir, FIXTURE_FILE), 'utf8').catch(() => null);
  if (!raw) return null;
  return { ...JSON.parse(raw), hash: createHash('sha1').update(raw).digest('hex').slice(0, 10) };
}

/**
 * What recorded responses hold: JSON bodies with data, empty JSON arrays/objects and 4xx statuses, and
 * whether the recording backend seeds data (`seeded`, or a seed/reset script in its run command; null without a backend).
 */
export function summarizeFixtureData(fixtures, backend = null) {
  const responses = [...Object.values(fixtures.entries ?? {}), ...Object.values(fixtures.sessions ?? {}).flatMap(Object.values)];
  const seedStep = new RegExp(`\\brun (?:${SEEDS.join('|')})(?![\\w:-])`);
  const summary = { data: 0, empty: 0, clientErrors: 0, seeded: backend ? !!backend.seeded || seedStep.test(backend.run) : null };
  for (const entry of responses) {
    if (entry.status >= 400) {
      if (entry.status < 500) summary.clientErrors++;
      continue;
    }
    if (!/json/i.test(entry.contentType ?? '')) continue;
    let value;
    try { value = JSON.parse(entry.body); } catch { continue; }
    if (value === null || (typeof value === 'object' && !Object.keys(value).length)) summary.empty++;
    else summary.data++;
  }
  return summary;
}

/** Writes recorded fixtures: { recordedAt, source, entries: { [requestKey]: response } }. */
export async function saveFixtures(fixturesDir, fixtures) {
  await mkdir(fixturesDir, { recursive: true });
  await writeFile(path.join(fixturesDir, FIXTURE_FILE), JSON.stringify(fixtures));
}

/**
 * Serves every request to the fake API origin from the fixtures. Requests that
 * were never recorded get a fast 404 (so client retries don't stall the page)
 * and are passed to `onUnrecorded`.
 */
export async function replayFixtures(context, { fakeOrigin, apiPaths = [], appOrigin, fixtures, onUnrecorded, onRequest = () => {}, fault }) {
  await context.route(apiRequestMatcher({ fakeOrigin, apiPaths, appOrigin }), async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(request, appOrigin) });
    const key = requestKey(request.method(), request.url());
    const recorded = fixtures?.entries?.[key];
    if (!recorded) {
      onUnrecorded(key);
      return route.fulfill({
        status: 404,
        headers: { ...corsHeaders(request, appOrigin), 'content-type': 'application/json', 'x-spotter-unrecorded': '1' },
        body: JSON.stringify({ error: 'Not recorded by Spotter', request: key }),
      });
    }
    onRequest(key);
    if (fault?.key === key) {
      if (fault.kind === 'delay') {
        const open = await new Promise((resolve) => {
          const closed = () => { clearTimeout(timer); resolve(false); };
          const timer = setTimeout(() => { context.off('close', closed); resolve(true); }, fault.delayMs);
          context.once('close', closed);
        });
        if (!open) return;
      }
      else if (fault.kind === 'abort') return route.abort('internetdisconnected');
      else {
        const headers = { ...corsHeaders(request, appOrigin), 'content-type': 'application/json', 'x-spotter-injected': '1' };
        if (fault.kind === 'malformed') return route.fulfill({ status: recorded.status, headers: { ...headers, 'content-type': recorded.contentType ?? 'application/json' }, body: '{"injected": "malformed' });
        if (fault.kind === '429') headers['retry-after'] = '1';
        return route.fulfill({ status: Number(fault.kind), headers, body: '{"error":"Injected failure"}' });
      }
    }
    return route.fulfill({
      status: recorded.status,
      headers: { ...corsHeaders(request, appOrigin), 'content-type': recorded.contentType ?? 'application/json' },
      body: recorded.encoding === 'base64' ? Buffer.from(recorded.body, 'base64') : recorded.body,
    });
  });
}

/**
 * Forwards requests for the fake API origin to the live API and stores each
 * response in `entries` (first response per request key wins).
 */
export async function recordFixtures(context, { fakeOrigin, apiPaths = [], liveOrigin, appOrigin, entries, headers = {}, secrets = [] }) {
  const liveBase = liveOrigin.replace(/\/+$/, '');
  await context.route(apiRequestMatcher({ fakeOrigin, apiPaths, appOrigin }), async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(request, appOrigin) });
    const url = new URL(request.url());
    const liveUrl = liveBase + url.pathname + url.search;
    let response;
    try {
      response = await route.fetch({ url: liveUrl, timeout: 90_000, ...(Object.keys(headers).length ? { headers: { ...request.headers(), ...headers } } : {}) });
    } catch (error) {
      return route.fulfill({ status: 502, headers: corsHeaders(request, appOrigin), body: String(error.message) });
    }
    const contentType = response.headers()['content-type'] ?? 'application/octet-stream';
    const body = await response.body();
    const isText = TEXT_CONTENT_TYPE.test(contentType);
    const key = requestKey(request.method(), request.url());
    const entry = {
      status: response.status(),
      contentType,
      encoding: isText ? 'utf8' : 'base64',
      body: isText ? body.toString('utf8') : body.toString('base64'),
    };
    entries[key] ??= isText ? redactSecrets(entry, secrets) : entry;
    return route.fulfill({
      status: response.status(),
      headers: { ...corsHeaders(request, appOrigin), 'content-type': contentType },
      body,
    });
  });
}

function corsHeaders(request, appOrigin) {
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
  };
}
