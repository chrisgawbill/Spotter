# Authentication testing

Spotter supplies isolated Playwright contexts, fixture replay and named findings.
Each project owns its sign-in forms, providers, redirects, assertions and API
contracts in project-repository specs. No provider-specific code belongs in Spotter.

## Choose the evidence you need

| Check | What it establishes |
| --- | --- |
| Seeded session | Signed-in rendering, restoration and session-dependent behavior |
| Controlled browser flow | Form or OAuth interactions, exchange payloads, failure states and sign-out |
| Live authentication | The deployed app, API and provider work together with a test account |
| Backend integration tests | Identity linking, token validation, encryption and database migrations |

A simulated exchange does not verify the real provider or backend security.
Keyboard tests can check focus, dialog operation and accessible names; a human
screen-reader pass remains separate.

## Saved sessions

Project specs and the page sweep have separate authentication setup. A spec can
perform login or supply its own browser storage without signing in the sweep.
To sweep signed-in pages as well as anonymous pages, configure `web.sessions`:

```yaml
web:
  sessions:
    - name: member
      localStorage: { app-session-token: test-session-token }
  specs:
    files: [qa/sign-in.spec.mjs]
```

Replace the storage key and value with a session your app accepts. Each configured
route, viewport and colour scheme then runs anonymously and as `member`. The
report's “signed-in sweep (no sessions configured)” message refers to this sweep,
even when authentication specs pass. A configured session must actually restore
successfully in the app; its name alone does not prove authentication.

When replaying an API, each named session needs its own fixture map. Record with
an accepted test session, or supply controlled responses for a synthetic session,
including session restoration and signed-in endpoints. A made-up token sent to a
live API will normally be rejected. Synthetic responses establish frontend
behavior only; preserve or recreate them if you replace the fixtures.

Existing `localStorage` session configuration still works. For cookies and
localStorage together, export a Playwright storage-state JSON file to a private
directory, then configure:

```yaml
web:
  sessions:
    - name: member
      storageState: /run/spotter-auth/member.json
      storageOrigin: https://app.example.test
  specs:
    files: [qa/sign-in.spec.mjs, qa/account.spec.mjs]
```

`storageState` must be an absolute path visible to Spotter. With the Docker
wrapper, set `SPOTTER_AUTH_DIR` to the host directory containing private state;
it is mounted read-only at `/run/spotter-auth`. Files outside the exported
checkout survive export and cleanup. For direct Node execution, use an absolute
path on that machine. Do not commit state files.

Spotter serves builds on a different local port each run. `storageOrigin`, when
set, remaps that exact origin's localStorage and that hostname's cookies to the
served app. Other origins and cookie domains stay unchanged. Cookie paths,
expiry, HttpOnly, Secure and SameSite attributes are preserved; use an appropriate
test session for local HTTP. Omitting `storageOrigin` preserves saved origins.
Configured `localStorage` overrides saved values; theme entries override both.
State is loaded once per context so reloads do not undo sign-out or storage edits.
Session-file contents participate in the baseline cache key.

Anonymous visits always run. Use `test.use({ spotterSession: 'member' })` in a
project spec to select a named session. Each test starts with a fresh context.
Re-record authenticated API responses after configuring a session; replay still
uses a separate fixture map for each named session.

## Interactive flows with controlled responses

Import Spotter's adapter in project-owned specs:

```js
const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);

test('AUTH Verify: rejected login stays signed out', async ({ page, context }) => {
  // Register after the adapter: this handler takes priority over fixture replay.
  await context.route('**/api/login', async route => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'member@example.test', password: 'wrong-password',
    });
    await route.fulfill({ status: 401, json: { error: 'Invalid credentials' } });
  });
  await page.goto('./');
  await page.getByLabel('Email').fill('member@example.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid credentials');
});
```

Use `context.route` for OAuth provider navigation as well: check state, redirect
URI and PKCE challenge, then fulfill a redirect to the app's callback. Preserve
the same tab so its sessionStorage remains intact. For popup-based flows,
register context routes before the click and use `page.waitForEvent('popup')`;
context routing covers the popup's first request. Intercept every provider
origin the flow can visit; routine checks must not depend on real provider pages.
Assert the exchange request body and control each response explicitly. Generic
recorded fixtures match method and URL, not request bodies or response sequences.

The [runnable example](../examples/authentication/auth.spec.mjs) includes form
login, an HttpOnly cookie, restore, expiry, sign-out, OAuth success, cancellation,
state mismatch, rejected exchange, PKCE assertions and callback cleanup. Its
[index.html](../examples/authentication/index.html) is a tiny example project,
not a reusable authentication implementation.

## Explicit live checks

Live specs are separate files, selected only by `--live-auth`:

```yaml
web:
  specs:
    files: [qa/sign-in.spec.mjs]
    live:
      files: [qa/sign-in.live.spec.mjs]
      baseURL: https://staging.example.test/
      env: [QA_EMAIL, QA_PASSWORD]
```

Supply credentials in the invoking environment, then run:

```bash
SPOTTER_AUTH_ENV='QA_EMAIL QA_PASSWORD' bin/spotter run my-app --ref feature/auth --live-auth
```

The wrapper forwards the selected variable names without putting their values
in command arguments. Missing or empty required values fail with the variable's
name. In live specs, `spotterLive` is true and `spotterCredentials` contains only
the listed variables. Routine specs receive an empty credentials object and
those configured variables are removed from their subprocess environment.

Live checks target the configured deployed URL, skip the local build/sweep,
fixture replay and frozen clock, and start without seeded sessions. They always
run without baseline comparison because they inspect the deployed environment,
not two exported versions. Reports label live authentication and record spec
mode. Select a test/staging environment and account suitable for the actions in
the project specs. Provider MFA or consent may need a separate interactive check;
Spotter does not solve CAPTCHAs or bypass provider authentication.

## Private output

Raw spec settings, browser artifacts and the raw Playwright report are kept in
a temporary private directory and removed after the run. Stored session values
and configured credential values are redacted from persisted replay-spec logs
and findings. Live checks withhold raw logs and failure details to avoid exposing
new OAuth codes or tokens; named failures identify the spec to inspect.

Keep test names free of secrets. Specs are trusted project code: do not write
credentials to custom files, attach private artifacts, or override artifact
capture in authentication specs. Screenshots of private signed-in pages can
contain account data; private storageState sessions omit sweep screenshots.
Use synthetic localStorage sessions when visual review is required. Fixture
recordings may contain account data and must remain private.
