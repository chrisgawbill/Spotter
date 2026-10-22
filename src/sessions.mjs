import { readFile } from 'node:fs/promises';

/** Read private state without including its contents in parse errors. */
export async function readSessionState(session) {
  if (!session.storageState) return { cookies: [], origins: [] };
  try {
    const state = JSON.parse(await readFile(session.storageState, 'utf8'));
    if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)
      || state.cookies.some((cookie) => !cookie || ['name', 'value', 'domain', 'path'].some((field) => typeof cookie[field] !== 'string'))
      || state.origins.some((origin) => !origin || typeof origin.origin !== 'string' || !Array.isArray(origin.localStorage) || origin.localStorage.some((entry) => !entry || typeof entry.name !== 'string' || typeof entry.value !== 'string'))) throw new Error();
    return state;
  } catch {
    throw new Error(`Session "${session.name}": cannot read storageState; provide a readable Playwright state JSON file`);
  }
}

/** Seed once through native storageState, allowing later logout/storage changes. */
export async function sessionStorageState(session, appOrigin, theme = {}) {
  const state = await readSessionState(session);
  const source = session.storageOrigin;
  if (source) {
    const hostname = new URL(source).hostname;
    state.cookies = state.cookies.map((cookie) => cookie.domain?.replace(/^\./, '') === hostname
      ? { ...cookie, domain: new URL(appOrigin).hostname } : cookie);
    state.origins = state.origins.map((entry) => entry.origin === source ? { ...entry, origin: appOrigin } : entry);
  }
  let origin = state.origins.find((entry) => entry.origin === appOrigin);
  if (!origin) state.origins.push(origin = { origin: appOrigin, localStorage: [] });
  const entries = new Map((origin.localStorage ?? []).map(({ name, value }) => [name, value]));
  for (const [name, value] of Object.entries({ ...session.localStorage, ...theme })) entries.set(name, value);
  origin.localStorage = [...entries].map(([name, value]) => ({ name, value }));
  return state;
}

/** Remove known private values from structured evidence before persisting it. */
export function redactSecrets(value, secrets) {
  if (typeof value === 'string') return secrets.filter(Boolean).sort((a, b) => b.length - a.length).reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]));
  return value;
}
