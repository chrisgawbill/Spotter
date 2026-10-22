# Spotter Agent Entry Point

Spotter is a generic QA runner; nothing in `src/` may be specific to one
project. Project knowledge belongs in `projects/<name>.yml`.

1. Read `README.md` (what a run does, config fields) and the selected ticket in `docs/ticket-index.md`.
2. Read only the modules the ticket touches: `cli.mjs` (commands, run orchestration), `runner.mjs` (one side of a run), `stages/` (static, rules, web, in-page probes), `parsers/`, `findings.mjs` (fingerprints, baseline split), `report.mjs`.
3. Keep `report.md` short and actionable; anything that makes it longer must earn its place.
4. Fingerprints (`createFinding` `key`) must not include line numbers, pixel counts or hashed class names, or baseline comparison breaks.

Verify with `npm test`, then a real run: `bin/spotter run hockeystats-webapp --ref main`
(expect only real findings) and a branch with seeded defects (each must show as new).

Commits: branch names describe the work; do not mention AI tools in code,
comments, commit messages or pull requests.
