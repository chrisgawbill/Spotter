# Working on Spotter with Claude Code

Read and follow [AGENTS.md](AGENTS.md) and [README.md](README.md) first.
They define project boundaries, reporting requirements and verification.

## Dashboard design cleanup

The current assignment is to review the dashboard design and implement a focused
cleanup. Read QA-06 in [the ticket index](docs/ticket-index.md),
[dashboard behavior](docs/dashboard.md), and
[configuration editing](docs/project-configuration.md). QA-08 through QA-21 are
IDEA backlog items, not part of this cleanup.

Inspect the rendered dashboard before choosing changes. Improve hierarchy,
spacing, typography, navigation, responsive layouts, status clarity and form
usability. Include loading, empty, running, failed and completed states, the
configuration editor and the embedded report. Use the existing
`@chrisgawbill/aero-md3-core` CSS, tokens and component styles; prefer small
HTML/CSS changes to new dependencies or a framework rewrite.

Relevant files:

- `src/dashboard/index.html`: page structure.
- `src/dashboard/dashboard.css`: dashboard styles.
- `src/dashboard/dashboard.js`: browser interaction and polling.
- `src/dashboard.mjs`: server routes; read when needed for a behavior change.
- `integration/dashboard.test.mjs`: real dashboard regression checks.

Preserve branch selection, live progress, reloadable run links, visual evidence,
configuration generation/editing, stale-edit and unsaved-change protection.
Keep Tailscale-only binding, same-origin run controls and sandboxed reports.
Keep keyboard operation, visible focus, meaningful labels and status updates;
status must remain understandable without color. Preserve functional element IDs
or update their JS/test callers together. Do not add controls for backlog features
that are not implemented. Do not place project-specific behavior in `src/`.

## Skills

Use [Ponytail](.claude/skills/ponytail/SKILL.md) for implementation: understand the
flow, reuse existing code and design tokens, and make the smallest complete fix.
It is also available as `/ponytail full`. Its upstream MIT license is bundled
alongside it.

Use [Handoff](.claude/skills/handoff/SKILL.md) (`/handoff`) to delegate implementation
once you have written and validated the dashboard cleanup plan. The required
[coder subagent](.claude/agents/coder.md) is included. Freeze design decisions,
assign non-overlapping file ownership, and independently verify the integrated
result. Give each worker the applicable Ponytail guidance explicitly; this
project installation does not include the plugin's automatic injection hooks.
For a cleanup too small to split usefully, implement it directly.

These Handoff and coder files were copied from Triple Crown's project setup.
Its unrelated product workflow and approval gates do not apply to Spotter.

## Verification and handoff

Run `npm test` and the dashboard browser integration command documented in
`docs/dashboard.md`. Follow AGENTS.md for main/seeded verification, and list
anything failed or skipped. Inspect desktop and narrow mobile layouts, keyboard
navigation, configurations and embedded reports. Save before/after screenshots
and provide their paths with test results and remaining limitations.

The deliverable is implemented and verified dashboard cleanup, not just a design
critique. Ticket acceptance remains with the Product Owner. Do not restart live
services, activate pipelines or deploy unless the user requests it.
