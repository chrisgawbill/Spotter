# Spotter

Independent, automatic QA for web projects. One command checks a branch and
prints a short report of what is **new** on it compared with its merge base,
so coding agents read one report instead of rebuilding test setups,
screenshot loops and API mocks for every ticket.

```bash
bin/spotter run hockeystats-webapp --ref feature/my-change      # prints report.md; exit 1 = new high/medium findings
bin/spotter run hockeystats-webapp --repo ~/worktrees/x --working-tree   # another clone, uncommitted changes included
bin/spotter record hockeystats-webapp                           # (re)record API fixtures from the live API
bin/spotter list
```

Runs in Docker (`bin/spotter build-image` after dependency changes; it builds
itself on first use). Results go to `~/spotter/<project>/runs/<run>/`
(`runs/latest` points at the newest): `report.md`, `report.json`,
`screenshots/`, `logs/`.

## What a run does

1. **Export** the ref with `git archive` (the project's checkout is never touched; `--working-tree` copies uncommitted files instead).
2. **Static:** install, then each configured check. Parsers turn `tsc`, Vitest JSON and Prettier output into findings with file and line; anything else reports exit code and log tail.
3. **Rules:** forbidden text in commit messages, added lines or files (e.g. "no AI mentions", "no `../../` imports"), and import boundaries between slices with an allowlist.
4. **Web:** builds the app with its API URL pointed at a fake origin, serves it, and visits every route × viewport × colour scheme in Chromium with the recorded API responses and the clock frozen at record time. Reports uncaught errors, console errors, failed requests, API errors, requests missing from the fixtures, pages that scroll sideways or cut content off at the right edge (naming the elements), blank pages and configured error text. Saves a full-page screenshot of each.
5. **Compare:** the same run on the merge base (cached by commit, config, fixtures and Spotter version) splits findings into new / already on base / fixed. Only new ones are listed.

## Adding a project

Create `projects/<name>.yml`; `projects/hockeystats-webapp.yml` is the
annotated reference. Fields:

| Field | Meaning |
| --- | --- |
| `repo`, `baseBranch`, `workdir` | Checkout (absolute host path), branch to compare against, directory commands run in |
| `install` | Dependency install command |
| `checks[]` | `name`, `run` (`{output}` = report file path), `parser` (`tsc`, `vitest`, `prettier`, `generic`), `severity`, optional `repro` |
| `rules.forbiddenText[]` | `id`, `pattern` (regex), `flags`, `in` (`commits`, `added-lines`, `files`), `glob` (relative to `workdir`), `message`, `severity` |
| `rules.importBoundaries[]` | `id`, `root` (slices directory), `aliases`, `allow[]` of `{ from, to }` (`to` may be a path inside a slice; `*` = any) |
| `web.build` | `run`, `outDir`, `env` |
| `web.base` | Base path the app is served under |
| `web.api` | `envVar` the build reads the API origin from; `recordFrom` live API for `record` |
| `web.routes[]` | `{ name, path }` (hash routes include `#/`) |
| `web.viewports`, `web.colorSchemes` | Widths (or `{ width, height }`) and `light`/`dark` |
| `web.colorSchemeStorage` | localStorage entries to seed per scheme, for apps with their own theme switch |
| `web.errorText`, `web.ignoreConsole`, `web.ignoreRequests` | Visible text that means failure; regexes to ignore |

Projects under `~/projects` are mounted automatically; `--repo` paths elsewhere are mounted on demand.

## Severity and exit codes

`high` (build/type/test failures, uncaught errors, blank pages) and `medium`
(console errors, layout overflow, rule violations, API 5xx, unrecorded
requests) fail the run (exit 1). `low` (formatting, external asset failures,
recorded API 4xx) is reported but does not fail. Exit 2 means Spotter itself
failed.

## Development

`npm test` runs the unit tests (Node's test runner). Design and tickets:
[docs/ticket-index.md](docs/ticket-index.md).
