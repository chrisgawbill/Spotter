# Working on Spotter

Spotter is a generic QA runner. Keep project-specific configuration in
`projects/<name>.yml` and project-owned specs in that project's repository.
Nothing in `src/` may be specific to one project.

## Read first

1. Read [README.md](README.md) for run behavior and config fields.
2. For ticket work, read only the selected ticket in
   [docs/ticket-index.md](docs/ticket-index.md). Follow its scope and Verify list.
3. Follow the README's task links for detailed usage. Historical test results
   live in [docs/ticket-evidence.md](docs/ticket-evidence.md); they are snapshots,
   not proof that today's changes pass.
4. Read only the relevant modules under `src/`:

| Area | Module |
| --- | --- |
| Commands and orchestration | `cli.mjs` |
| One side of a comparison | `runner.mjs` |
| Static, rules, browser and in-page checks | `stages/` |
| Check output parsing | `parsers/` |
| Fingerprints and baseline split | `findings.mjs` |
| Reports | `report.mjs` |

## Preserve these constraints

- Keep `report.md` short and actionable. Put visual evidence in `report.html`.
- A `createFinding` key must remain stable across runs. Exclude line numbers,
  pixel counts and hashed class names; they break baseline comparison.
- Branch names describe the work. Do not mention AI tools in code, comments,
  commit messages or pull requests.

## Verify

Run `npm test`, then real checks:

```bash
bin/spotter run hockeystats-webapp --ref main
bin/spotter run hockeystats-webapp --repo /path/to/seeded-checkout --ref seeded-branch
```

Main should report only real findings, with no new findings against itself.
Each seeded defect must appear as new. Include the result paths and any failed
or skipped verification in the handoff.
