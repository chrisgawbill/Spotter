import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

/** Loads a project's recorded fixtures, or null when none have been recorded. */
export async function loadFixtures(fixturesDir) {
  const raw = await readFile(path.join(fixturesDir, FIXTURE_FILE), 'utf8').catch(() => null);
  if (!raw) return null;
  return { ...JSON.parse(raw), hash: createHash('sha1').update(raw).digest('hex').slice(0, 10) };
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
export async function replayFixtures(context, { fakeOrigin, appOrigin, fixtures, onUnrecorded }) {
  await context.route(`${fakeOrigin}/**`, async (route) => {
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
export async function recordFixtures(context, { fakeOrigin, liveOrigin, appOrigin, entries }) {
  const liveBase = liveOrigin.replace(/\/+$/, '');
  await context.route(`${fakeOrigin}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(request, appOrigin) });
    const liveUrl = liveBase + request.url().slice(fakeOrigin.length);
    let response;
    try {
      response = await route.fetch({ url: liveUrl, timeout: 90_000 });
    } catch (error) {
      return route.fulfill({ status: 502, headers: corsHeaders(request, appOrigin), body: String(error.message) });
    }
    const contentType = response.headers()['content-type'] ?? 'application/octet-stream';
    const body = await response.body();
    const isText = TEXT_CONTENT_TYPE.test(contentType);
    const key = requestKey(request.method(), request.url());
    entries[key] ??= {
      status: response.status(),
      contentType,
      encoding: isText ? 'utf8' : 'base64',
      body: isText ? body.toString('utf8') : body.toString('base64'),
    };
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
