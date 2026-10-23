# Dashboard cleanup — frozen contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

Scope: QA-06 design cleanup. Files: `src/dashboard/index.html`, `src/dashboard/dashboard.css`,
`src/dashboard/dashboard.js`, `integration/dashboard.test.mjs`. No server changes, no new
dependencies, only `@chrisgawbill/aero-md3-core` tokens/classes plus the local classes below.

## 1. Element IDs

Every existing `id` in `index.html` stays, with the same element type and meaning.
No new IDs are needed by JS.

## 2. Local CSS classes (shared vocabulary between markup and JS)

| Class | Applied by | Meaning |
| --- | --- | --- |
| `app-bar` | HTML | Sticky top bar (`<header>`) |
| `brand` | HTML | Product name link |
| `nav-link` | HTML | Top navigation link; active one has `aria-current="page"` |
| `page-intro` | HTML | Wrapper of `#page-title` + `#page-description` |
| `section-head` | HTML | Row: heading left, meta/actions right |
| `run-meta` | HTML | Wrapper of `#identity` + `#updated` |
| `scroll-region` | HTML | Height-capped, keyboard-focusable scroll list (`#current`, `#events`) |
| `button-secondary` | HTML + JS | Tonal secondary button, used with `ds-button` |
| `button-danger` | HTML | Outlined destructive button, used with `ds-button` |
| `empty-state` | HTML + JS | Dashed-border empty message |
| `status` / `status-<pass\|fail\|running\|error>` | JS | Run status chip (with `ds-chip ds-chip-<tone>`) |
| `side` | JS | `head`/`base`/`run` label inside activity lists |
| `branch` | JS | Branch name text |
| `activity-text` | JS | Run-table activity text, visually clamped to 2 lines |
| `is-paused` | JS | On `#synced` while polling fails |
| `runs-table` | HTML | The recent-runs `<table>` (stacks at ≤600px) |
| `config-card`, `project-card` | JS | Cards in `#config-list` / `#projects` |
| `folder-button` | JS | Folder rows in `#folder-list` |

## 3. Status chip (JS `badge`)

```js
const statuses = { pass: ['success', '✓'], fail: ['danger', '✕'], running: ['primary', '●'], error: ['warning', '!'] };
const badge = (status) => {
  const [tone, icon] = statuses[status] ?? ['danger', '!'];
  return `<span class="ds-chip ds-chip-${tone} status status-${escape(status)}"><span aria-hidden="true">${icon}</span>${escape(status.toUpperCase())}</span>`;
};
```

The uppercase word stays as text (tests read `PASS`/`FAIL`/`RUNNING`); the icon is decorative.
`error` (Spotter failed) uses warning tone, distinct from `fail` (new findings).

## 4. Exact JS-rendered markup

- Project card: `<article class="project-card ds-card ds-aero-surface ds-stack"><h3>NAME</h3>` +
  latest ? `BADGE<p class="branch">BRANCH</p><a href="LINK">Open latest run →</a>` : `<p class="muted">No runs yet</p>` + `</article>`
- No projects in `#projects`: `<p class="empty-state">No projects configured yet. <a href="#configs">Add a configuration</a> to start running checks.</p>`
- Run row: `<tr><td><strong>PROJECT</strong><br><span class="branch">BRANCH</span></td><td>BADGE</td><td><span class="activity-text" title="TEXT">TEXT</span></td><td><a href="LINK">Follow activity →|View run →</a><br><small>STARTED</small></td></tr>` (TEXT escaped; same text source as today).
- Current activity item: `<li><span class="side">SIDE</span> ACTIVITY</li>`
- History item: `<li><time>TIME</time> <span class="side">SIDE</span> ✓ Completed|→ Started ACTIVITY</li>`
- Config card: `<article class="config-card ds-card ds-aero-surface ds-stack"><h3>NAME</h3><button class="ds-button button-secondary" type="button" data-config="NAME">Edit configuration</button></article>`
- No configs: `<p class="empty-state">No configurations yet. Use Set up from folder or New configuration to add one.</p>`
- Folder buttons: `class="ds-button button-secondary folder-button"` (same text/attributes as today); no subfolders: `<p class="muted">No subfolders</p>`
- Reuse buttons in `#setup-existing`: `class="ds-button button-secondary"` (otherwise unchanged).
- Coverage status cell: `<td><span class="ds-chip TONE">STATUS</span></td>`, TONE from
  `{ preserved: 'ds-chip-success', detected: 'ds-chip-success', review: 'ds-chip-warning', inferred: 'ds-chip-primary' }[status] ?? ''`.

## 5. JS behavior rules

- `refresh()` sets `aria-current="page"` on the `nav a.nav-link` whose `href` is `#configs` when
  `location.hash === '#configs'`, otherwise on the one whose `href` is `#`; removes it from the other.
  Runs at the very start of `refresh()` (before awaits), next to the existing page-title switch.
- `#project-info` text: `project?.error ?? (project ? \`Compare against ${project.baseBranch ?? 'main'}. Runs use recorded API fixtures.\` : 'Add a project configuration to start a run.')`
- `#synced`: success → remove class `is-paused`; catch → add `is-paused` (text unchanged).
- Nothing else in JS changes: polling, focus preservation (`html()`), dirty/stale-edit logic,
  report `src` handling and hash routing stay exactly as they are.

## 6. Initial (loading) markup in HTML

- `#submit` has the `disabled` attribute in HTML (JS enables it once a branch exists).
- `#project-info`: `Loading projects…`; `#projects`: `<p class="muted">Loading projects…</p>`;
  `#synced`: `Loading runs…`.
- The runs table wrapper is hidden by CSS while `#runs` is empty: `.ds-table-wrap:has(#runs:empty){display:none}`.
