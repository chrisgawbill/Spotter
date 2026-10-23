# Dashboard cleanup — STATE (coordinator-owned, overwritten per wave)

## Landed and verified
- `behavior` (dashboard.js): contract items 1-12; diff reviewed, escaping intact.
- `markup` (index.html, dashboard.css): items 1-11 + CSS; IDs identical to HEAD; aero-md3 tokens throughout (remaining literals have no core token).
- Coordinator: `ds-stack` on the Start-a-run and Current-activity cards (heading spacing); `aria-current` assertions in `integration/dashboard.test.mjs`.

## Verification
- `npm test`: 41/41 pass.
- `integration/dashboard.test.mjs` in `spotter:latest`: 1/1 pass.
- Seeded state preview (loading, empty, running, error, fail + report, pass, updates paused, configs, editor, folder picker, generated draft, keyboard) at 1280 and 375: no page errors, no horizontal overflow, visible focus on every tab stop.

## Open
- Product Owner acceptance of QA-06 design.
