# Brief: markup (index.html + dashboard.css)

Repo: `/home/chris_dev/projects/Spotter`. Report to `docs/plans/dashboard-cleanup-progress/markup.md`.

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
Smallest complete diff. Reuse aero-md3 classes/tokens (`ds-stack`, `ds-cluster`, `ds-grid`,
`ds-card`, `ds-aero-surface`, `ds-aero-glass`, `ds-chip*`, `ds-button`, `ds-input`, `ds-field`,
`ds-table*`, `ds-focus-outline`, `ds-visually-hidden`; tokens `--ds-color-*`, `--ds-space-1..5`,
`--ds-font-size-*`, `--ds-font-weight-*`, `--ds-radius-*`, `--ds-layer-sticky`,
`--ds-focus-outline-*`). No hard-coded colors/sizes where a token exists. No new files, no
dependencies, no speculative classes. Delete CSS rules that become dead.
Reference: `node_modules/@chrisgawbill/aero-md3-core/src/core.css` (read it for token names).

## Ownership
Write only: `src/dashboard/index.html`, `src/dashboard/dashboard.css`.
`src/dashboard/dashboard.js` is being edited **right now** by agent `behavior`; do not touch it.
`integration/dashboard.test.mjs` is coordinator-owned.

## Contract (pasted)
Keep every existing `id` with its element type. Keep `sandbox="allow-same-origin"` on `#report`,
`role="alert"` on `#error`, `role="status"` on `#run-error`/`#synced`/`#folder-message`/`#config-message`,
`aria-live="polite"` on `#current`/`#field-suggestion`, `aria-describedby` links, `required`/`pattern` attrs.
JS (other agent) will render these classes into the DOM — you style them:
`status`, `status-pass|fail|running|error` (on a `ds-chip ds-chip-<tone>` span containing
`<span aria-hidden="true">ICON</span>WORD`), `side`, `branch`, `activity-text`, `is-paused` (on `#synced`),
`project-card`, `config-card`, `folder-button`, `button-secondary`, `empty-state`, `<time>` inside `#events li`.

## Task — index.html
1. Header → `<header class="app-bar ds-aero-glass"><div class="ds-container ds-cluster"><a class="brand ds-focus-outline" href="#"><span aria-hidden="true">◉</span> Spotter</a><nav class="ds-cluster" aria-label="Dashboard"><a class="nav-link ds-focus-outline" href="#">Runs</a><a class="nav-link ds-focus-outline" href="#configs">Configurations</a></nav><span class="ds-chip ds-chip-primary" title="Served only on the Tailscale network">Tailscale only</span></div></header>`. Remove the "Independent QA" span.
2. Intro: remove the `PROJECT CONTROL` eyebrow `<p>`; wrapper div gets `class="page-intro"` (keep `#page-title` h1 and `#page-description`).
3. Start form: add `disabled` to `#submit`; `#project-info` initial text `Loading projects…`.
4. `#detail`: first row → `<div class="section-head"><h2 id="detail-title" tabindex="-1">Run activity</h2><span id="status" role="status"></span><a class="ds-button button-secondary" href="#">Close run</a></div>` (`#status` loses `ds-chip` — JS puts the chip inside it). Then wrap `#identity` and `#updated` in `<div class="run-meta">…</div>`.
5. `#current` → add `class="scroll-region" tabindex="0" aria-label="Current activity"` (keep aria-live). `#events` → add `class="scroll-region" tabindex="0" aria-label="Activity history"`.
6. `#report-section` → `class="ds-stack"`; replace the `<h3>` + `<p><a…></p>` with `<div class="section-head"><h3>Report &amp; visual review</h3><a id="report-link" target="_blank" rel="noopener">Open in a new tab ↗</a></div>`; iframe unchanged.
7. Projects section: `<section class="ds-stack">`, its head div `class="section-head"`, `#projects` initial content `<p class="muted">Loading projects…</p>`.
8. Recent runs section: `<section class="ds-stack">`, head div `class="section-head"`, `#synced` initial text `Loading runs…`, table gets `class="ds-table runs-table"`, `#empty` gets `class="empty-state"`.
9. Config page head → `<div class="section-head"><h2 id="config-title">Configurations</h2><div class="ds-cluster"><button id="setup-project" class="ds-button button-secondary" …>Set up from folder</button><button id="new-config" class="ds-button" …>New configuration</button></div></div>`.
10. Folder picker: `#folder-path` gets `class="path"`; `#close-folders` gets `button-secondary`.
11. Editor: `#apply-fields` and `#read-fields` get `button-secondary`. Action row → `<div class="ds-cluster editor-actions">` in order: `#save-config` (`ds-button`), `#close-config` (`ds-button button-secondary`), `#delete-config` (`ds-button button-danger`). Keep their types/IDs.

## Task — dashboard.css (rewrite in place; keep it compact, one rule per line style as today)
- Base: keep `--ds-layout-max-width:1280px`, box-sizing, body (add `line-height:1.5`), `a{color:primary}`, `[hidden]{display:none!important}`.
- `.app-bar`: `position:sticky;top:0;z-index:var(--ds-layer-sticky);border-width:0 0 1px;padding-block:var(--ds-space-2);margin-bottom:var(--ds-space-4)`. `.brand`: title size, bold, no underline, `margin-right:auto`. `.nav-link`: no underline, `padding:var(--ds-space-1) var(--ds-space-3)`, `border-radius:var(--ds-radius-full)`, `color:var(--ds-color-on-surface)`, weight medium; `.nav-link:hover` bg `--ds-color-surface-container-high`; `.nav-link[aria-current=page]` bg `--ds-color-primary-container`, color `--ds-color-on-primary-container`.
- Typography: `h1` `font-size:var(--ds-font-size-display);letter-spacing:-.02em;margin:0`; `h2` title size, `margin:0`; `h3` `font-size:var(--ds-font-size-body-large);margin:0`. `.page-intro p{margin:var(--ds-space-1) 0 0}`. `.muted` on-surface-variant.
- Spacing: `.ds-stack>p,.ds-stack>h2,.ds-stack>h3{margin:0}`; `.ds-card p{margin:0}` is NOT wanted (prose in suggestions) — instead `.project-card p,.config-card p{margin:0}`. `main{padding-bottom:var(--ds-space-5)}`, `main.ds-stack{gap:var(--ds-space-4)}`. `.ds-card{padding:var(--ds-space-4)}` (mobile `--ds-space-3`).
- `.section-head`: `display:flex;flex-wrap:wrap;align-items:center;gap:var(--ds-space-2) var(--ds-space-3)`; first child `margin-right:auto`.
- `.run-meta p{margin:0}`, `#identity{overflow-wrap:anywhere;font-weight:var(--ds-font-weight-medium)}`. `#detail{scroll-margin-top:5rem}`.
- `#status:empty{display:none}`. `.status{gap:var(--ds-space-1)}`.
- `.button-secondary{background:var(--ds-color-primary-container);color:var(--ds-color-on-primary-container);text-decoration:none}`; `.button-danger{background:transparent;color:var(--ds-color-danger);border-color:var(--ds-color-danger)}`; `.ds-button:disabled{opacity:.55;cursor:not-allowed}`; `.ds-button:hover:not(:disabled){filter:brightness(1.08)}`.
- `.empty-state{margin:0;padding:var(--ds-space-4);border:1px dashed var(--ds-color-outline-variant);border-radius:var(--ds-radius-medium);color:var(--ds-color-on-surface-variant);text-align:center}`.
- Start form: keep `form{align-items:end}`, labels `flex:1;min-width:180px`, selects 100%; `#start .ds-button` `min-width:10rem`.
- `.scroll-region`: `max-height:16rem;overflow:auto;margin:0;padding:var(--ds-space-2) var(--ds-space-3);list-style:none;background:var(--ds-color-surface);border:1px solid var(--ds-color-outline-variant);border-radius:var(--ds-radius-small);font:var(--ds-font-size-body-small)/1.7 ui-monospace,monospace;overflow-wrap:anywhere`. `#events{max-height:22rem}`. `.scroll-region li+li{border-top:1px solid var(--ds-color-outline-variant)}` (keep subtle; use `padding-block:2px`). `.side` → small uppercase label: `display:inline-block;min-width:4ch;margin-right:var(--ds-space-1);color:var(--ds-color-primary);font-weight:var(--ds-font-weight-bold)`. `#events time{color:var(--ds-color-on-surface-variant)}`. Keep `#current:empty::after{content:'Preparing run…'}`.
- `#run-error`: `margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--ds-font-size-body-small)/1.6 ui-monospace,monospace;padding:var(--ds-space-3);border-left:4px solid var(--ds-color-danger);background:color-mix(in srgb,var(--ds-color-danger) 8%,var(--ds-color-surface));border-radius:var(--ds-radius-small);color:var(--ds-color-on-surface)`; `#run-error:empty{display:none}`.
- `#error`: same banner look as `#run-error` but body font, `margin:0`.
- `#synced.is-paused{color:var(--ds-color-warning);font-weight:var(--ds-font-weight-medium)}`.
- `summary{cursor:pointer;font-weight:var(--ds-font-weight-semibold)}`; `details[open]>summary{margin-bottom:var(--ds-space-3)}`.
- Focus: `summary:focus-visible,.scroll-region:focus-visible,a:focus-visible{outline:var(--ds-focus-outline-width) solid var(--ds-focus-outline-color);outline-offset:var(--ds-focus-outline-offset)}`. Keep `.ds-input:focus-visible` rule.
- iframe: keep, height `80vh`; mobile `70vh`.
- Runs table: `.ds-table-wrap:has(#runs:empty){display:none}`; `.branch{color:var(--ds-color-on-surface-variant);overflow-wrap:anywhere}`; `.activity-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}`; `td{max-width:450px}` keep; `.runs-table td:last-child{white-space:nowrap}`.
- Mobile `@media(max-width:600px)`: `.runs-table thead` visually hidden (copy `.ds-visually-hidden` declarations); `.runs-table tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--ds-space-1) var(--ds-space-2);padding:var(--ds-space-3) 0;border-bottom:1px solid var(--ds-color-outline-variant)}`; `.runs-table td{display:block;max-width:none;padding:0;border:0;background:none!important}`; `.runs-table td:nth-child(3),.runs-table td:nth-child(4){grid-column:1/-1}`; `.runs-table td:last-child{white-space:normal}`; `#start .ds-button{width:100%}`; header cluster wraps.
- Projects/config cards: `.project-card,.config-card{gap:var(--ds-space-2);align-items:flex-start}`; `#config-list,#projects{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}`.
- Config editor: keep `.config-layout` grid, `#config-fields` 2-col, input width rules, `#config-source` monospace, `.suggestions` sticky — but `top:5rem` (below app bar), `.suggestions pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--ds-font-size-body-small);padding:var(--ds-space-2);background:var(--ds-color-surface);border-radius:var(--ds-radius-small)}`. `.config-layout .ds-stack>button{align-self:flex-start}`. `.editor-actions{padding-top:var(--ds-space-3);border-top:1px solid var(--ds-color-outline-variant)}`; `.editor-actions .button-danger{margin-left:auto}`. `#config-message,#folder-path,#folder-message{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}`; `.path{font-family:ui-monospace,monospace}`.
- Folder list: `#folder-list{gap:var(--ds-space-1)}`, `.folder-button{justify-content:flex-start;text-align:left;white-space:normal;overflow-wrap:anywhere;border-radius:var(--ds-radius-small)}`.
- Keep 800px breakpoint for config layout (suggestions `position:static`).
- Remove now-dead rules: `header>span`, `.eyebrow`, `section>.ds-cluster`, `.ds-cluster h2`, old `#events`/`#current` rules replaced above, `button:disabled{cursor:wait}`.

## Verify (you cannot run the browser test; the coordinator does)
- `npm test` must still be 41/41 (it does not cover these files, but run it).
- Grep that every ID from the original file still exists: compare `grep -o 'id="[^"]*"'` before (git show HEAD:src/dashboard/index.html) and after.
- Report: what you changed, any rule from this brief you could not apply, and `## ESCALATIONS`.
- Explicitly unverified: rendering, keyboard, mobile layout (coordinator verifies in Chromium).
