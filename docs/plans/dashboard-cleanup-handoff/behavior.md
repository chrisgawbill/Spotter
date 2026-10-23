# Brief: behavior (dashboard.js)

Repo: `/home/chris_dev/projects/Spotter`. Report to `docs/plans/dashboard-cleanup-progress/behavior.md`.

This brief is your primary context and is meant to be complete. But it is a summary
written by someone else, and it can be stale or wrong. If the actual code contradicts
it, **the code wins** — follow the code, and report the discrepancy to the coordinator.
Read beyond this brief when you genuinely need to; just don't re-read the full plan to
rediscover what is already written here.

**When you need context or judgement this brief does not give you, ask the coordinator
rather than working it out yourself.** Send it with
`SendMessage({to: "main", message: "..."})` — you are a background subagent, so `"main"`
reaches the coordinating Opus session that briefed you. Say what you were doing, the
specific question, and what you would do absent an answer. Then **stop and wait**; the
coordinator replies by messaging you back, which resumes you with your context intact.
If `SendMessage` is unavailable to you, stop and put the question at the top of your
report instead.

Which way to go:
- **Local and checkable** — what a function returns, which shape a row has, whether a
  guard exists: read the code. That is not a question, that is your job.
- **Design, scope, contract, or priority** — the brief is silent or ambiguous, two
  readings lead to different implementations, the contract seems wrong, the change wants
  a file you do not own: **ask.** Do not decide it yourself. Thinking is the
  coordinator's job and it has the whole picture; you have one slice of it.
- **Already resolved provisionally** — you made a call to keep moving: it still goes in
  `## ESCALATIONS`, even if the tests pass.

A question costs one round trip; a confident wrong guess costs a debugging cycle.

## Ponytail (full) — how to write it
Shortest correct diff. Edit the existing template strings in place; match the file's dense
one-line style. No new helpers beyond the `statuses` map below, no refactors, no renamed
variables, no comments beyond what exists.

## Ownership
Write only: `src/dashboard/dashboard.js` (233 lines).
`src/dashboard/index.html` and `src/dashboard/dashboard.css` are being edited **right now** by
agent `markup`; do not touch them. `integration/dashboard.test.mjs` is coordinator-owned.

## Task (exact markup — contract, pasted)
1. Line 4 `badge` → replace with:
   ```js
   const statuses = { pass: ['success', '✓'], fail: ['danger', '✕'], running: ['primary', '●'], error: ['warning', '!'] };
   const badge = (status) => {
     const [tone, icon] = statuses[status] ?? ['danger', '!'];
     return `<span class="ds-chip ds-chip-${tone} status status-${escape(status)}"><span aria-hidden="true">${icon}</span>${escape(status.toUpperCase())}</span>`;
   };
   ```
   `escape` is defined on line 3 — keep `badge` after it.
2. `updateBranches` (line 30) `#project-info`: `project?.error ?? (project ? \`Compare against ${project.baseBranch ?? 'main'}. Runs use recorded API fixtures.\` : 'Add a project configuration to start a run.')`.
3. `refresh()` start (next to the page-title lines 50-53, before any await): for each `document.querySelectorAll('nav a.nav-link')`, set `aria-current="page"` when `(a.getAttribute('href') === '#configs') === (location.hash === '#configs')`, else `removeAttribute('aria-current')`.
4. Line 58 config list: card → `<article class="config-card ds-card ds-aero-surface ds-stack"><h3>NAME</h3><button class="ds-button button-secondary" type="button" data-config="NAME">Edit configuration</button></article>`; empty → `<p class="empty-state">No configurations yet. Use Set up from folder or New configuration to add one.</p>`.
5. Line 62 run row → `<tr><td><strong>PROJECT</strong><br><span class="branch">BRANCH</span></td><td>BADGE</td><td><span class="activity-text" title="TEXT">TEXT</span></td><td><a href="LINK">Follow activity →|View run →</a><br><small>STARTED</small></td></tr>` — TEXT is today's expression `run.current.at(-1)?.activity ?? (run.report ? 'Report ready' : run.error ?? 'Preparing')`, escaped in both places (compute it once in the map callback).
6. Lines 64-67 project cards → `<article class="project-card ds-card ds-aero-surface ds-stack"><h3>NAME</h3>` + (latest ? `${badge(latest.status)}<p class="branch">BRANCH</p><a href="LINK">Open latest run →</a>` : `<p class="muted">No runs yet</p>`) + `</article>`; after `.join('')` add `|| '<p class="empty-state">No projects configured yet. <a href="#configs">Add a configuration</a> to start running checks.</p>'`.
7. Line 68 success → also `$('synced').classList.remove('is-paused')`; line 90 catch → also `$('synced').classList.add('is-paused')`.
8. Line 77 current → `<li><span class="side">${escape(e.side)}</span> ${escape(e.activity)}</li>` (fallbacks unchanged).
9. Line 81 events → `<li><time>${escape(time(e.at))}</time> <span class="side">${escape(e.side)}</span> ${e.state === 'done' ? '✓ Completed' : '→ Started'} ${escape(e.activity)}</li>` (fallback unchanged).
10. Line 153 coverage → status cell `<td><span class="ds-chip ${({ preserved: 'ds-chip-success', detected: 'ds-chip-success', review: 'ds-chip-warning', inferred: 'ds-chip-primary' })[item.status] ?? ''}">${escape(item.status)}</span></td>`.
11. Line 154 reuse buttons → class `ds-button button-secondary`.
12. Line 169 folder list → both button kinds get class `ds-button button-secondary folder-button`; `'<p>No subfolders</p>'` → `'<p class="muted">No subfolders</p>'`.

## What to keep (load-bearing — do not regress)
- `html()` focus-preserving diff helper; `escape()` on every interpolated value (XSS: data comes from branch names/YAML).
- Polling (`setInterval(refresh, 2000)`, `refreshing` guard), hash routing, `selected` scroll-once logic, report `src` set only when changed.
- Editor: `dirty`/`basicDirty`, `beforeunload`, `confirm()` prompts, `originalSource`/`previous` stale-edit protection, focus to `#config-name`.
- `data-config`, `data-folder`, `data-existing` attributes and visible texts `Edit configuration`, `Open latest run →`, `Follow activity →`, `View run →`, `↑ Parent folder`, `NAME →` (tests filter `repo →`).

## Verify
- `node --check src/dashboard/dashboard.js` (it is an ES module with top-level await: use `node --input-type=module --check < src/dashboard/dashboard.js`).
- `npm test` → 41/41 (baseline).
- Report with the final diff summary and `## ESCALATIONS`. Browser behavior is explicitly unverified by you; the coordinator runs the Chromium integration test.
