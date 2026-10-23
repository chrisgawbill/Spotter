# Brief: setup (QA-23)

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

## Ponytail rules (apply to how you write code inside the contract)

- Ladder, stop at the first rung that holds: already in this codebase → reuse it; stdlib → use it;
  native platform feature → use it; installed dependency → use it; one line → one line; only then the
  minimum code that works. Never add a dependency.
- Read the code the change touches and trace the real flow first; then take the shortest correct diff.
- Root cause, not symptom: fix in the shared function all callers route through.
- No unrequested abstractions, no scaffolding for later, no config for values that never change.
  Deletion over addition; boring over clever; fewest files.
- Two stdlib options of the same size: take the one correct on edge cases.
- Never simplify away validation at trust boundaries, error handling, security measures or
  anything the contract requires. Ponytail never licenses skipping or shrinking a contracted item;
  if it seems unnecessary, that is an escalation.
- Non-trivial logic leaves one runnable check behind (the tests listed below); no extra suites.
- Match the surrounding code's comment density, naming and idiom.

## Your files (allow-list)
- `src/route-discovery.mjs`
- `src/project-options.mjs`
- `test/route-discovery.test.mjs`
- `test/project-setup.test.mjs`

Concurrently, right now: `replay` edits `src/config.mjs` (it adds validation that accepts
`web.api: { paths, recordFrom }` without `envVar`), fixtures and the web stage; `backend` and
`coverage` edit other files. Do not touch any of them. `examples/same-origin-api/` is coordinator-owned
(read it as a realistic input; do not edit).

## Task
1. C6 route-discovery: `evidence.proxy` and `evidence.relativeRequests`, plus the unreadable-proxy note.
2. C6 project-options: propose `web.api.paths` / `recordFrom` from proxies, the multiple-targets note,
   the combined evidence string, and the relative-request note.

## Anchors
- `src/route-discovery.mjs:20` evidence object; `:21-23` `cleanUrl`; `:132-136` `literal`, `prop`;
  `:174` module `walk` (add the relative-request CallExpression check here; `memberPath` is at `:24`);
  `:273-285` framework config block (add proxy reading inside it, Vite files only).
- `src/project-options.mjs:25-30` single env-var `web.api` inference (add the proxy block right after `:30`).
- `src/project-setup.mjs:167` calls `normalizeConfig` on the generated config (owned by nobody in this
  wave; do not edit) — generated configs must validate.

## Keep
- Never import or execute project code; syntax only.
- Existing env-var inference, notes and evidence strings unchanged (tests assert them).
- `cleanUrl` rejects URLs with credentials, query or hash: keep using it for proxy targets.

## Required tests
- route-discovery: string proxy (`{ '/api': 'http://127.0.0.1:4010' }`), object proxy
  (`{ '/admin': { target: 'http://localhost:5209', changeOrigin: true } }`), multiple keys with two targets,
  trailing-slash key normalised, and computed cases (`proxy: makeProxy()`, `[key]: '…'`, `'^/api': …`, spread)
  each producing the unreadable-proxy note; a proxy in a non-Vite config file is ignored; relative requests
  from `fetch('/api/items')`, `apiFetch('GET', '/admin/collections')`, a template `` `/api/items/${id}` ``,
  and that `navigate('/teams')` and `fetch('//cdn.example.test/x')` and `fetch('https://…')` are not collected.
- project-setup (uses the `fixture()` helper and `detectProject`): a Vite app with a string proxy and no env var
  yields `config.web.api` = `{ paths: ['/api'], recordFrom: 'http://127.0.0.1:4010' }` and evidence naming
  `vite.config.js`; two proxy targets yield `paths` for both, no `recordFrom`, and the multiple-targets note;
  an app with relative `fetch('/api/items')` and no proxy/env var yields no `web.api` and the relative-request note;
  an app with an env-var API and relative calls gets no relative-request note.
  `detectProject` validates its own output through `normalizeConfig`; until the replay agent's config change
  lands this passes because `web.api` is currently unvalidated — note that in your report.

## Verification
- `node --test test/route-discovery.test.mjs test/project-setup.test.mjs` (do not run the full suite).
- Baseline before your change: `npm test` 86/86.

## Report
Write `docs/plans/api-fixtures-progress/setup.md`, ending with `## ESCALATIONS`.

## Contract (verbatim)

## C6 Setup inference (`src/route-discovery.mjs`, `src/project-options.mjs`, setup)

### route-discovery

`evidence` gains `proxy: []` and `relativeRequests: []`.

Proxy, inside the existing config block, only when `/^vite\.config\.[cm]?[jt]s$/.test(file)`:
`const proxy = resolve(prop(resolve(prop(config, 'server')), 'proxy'))`.

- `proxy` undefined → nothing.
- `proxy` not an ObjectExpression, or any property that is a SpreadElement, computed, keyed by
  something other than an Identifier/StringLiteral, or whose key does not start with `/`
  (Vite treats `^…` as a regex), or whose key is `/` → push the note once per file:
  `` `Could not statically read server.proxy in ${file}; configure web.api.paths manually.` ``
  and skip that property.
- Otherwise `path = key.replace(/\/+$/, '')`; `target = cleanUrl(literal(value) ?? literal(prop(value, 'target')))`
  (null when not a clean literal URL); push `{ path, target, file }`.

Relative requests, for every CallExpression in every scanned module:
the callee name (Identifier name, or MemberExpression property name) matches
`/fetch|request|^(?:get|post|put|patch|delete)$/i`; for each of the first two arguments, take
`literal(arg)`, or for a TemplateLiteral with expressions its first quasi's cooked text; when that
text matches `/^\/(?!\/)[\w-]/`, push `{ path: text.split(/[?#]/)[0], file }`.

### project-options (after the existing single-env-var `web.api` block)

```js
if (facts.proxy.length) {
  const paths = [...new Set(facts.proxy.map((item) => item.path))];
  const targets = [...new Set(facts.proxy.map((item) => item.target).filter(Boolean))];
  const files = [...new Set(facts.proxy.map((item) => item.file))];
  web.api = { ...web.api, paths };
  const fromProxy = !web.api.recordFrom && targets.length === 1 && facts.proxy.every((item) => item.target);
  if (fromProxy) web.api.recordFrom = targets[0];
  if (targets.length > 1) notes.push(`Multiple API proxy targets found (${targets.join(', ')}); select the API to record.`);
  const proxyEvidence = `${files.join(', ')}: dev-server proxy for ${paths.join(', ')}${fromProxy ? ' to a literal target; verify the recording target' : '; supply the recording URL'}`;
  evidence['web.api'] = evidence['web.api'] ? `${evidence['web.api']}; ${proxyEvidence}` : proxyEvidence;
}
if (!web.api && facts.relativeRequests.length) {
  const shown = [...new Set(facts.relativeRequests.map((item) => item.path))].slice(0, 3).join(', ');
  notes.push(`Relative API requests found in ${facts.relativeRequests[0].file} (${shown}) but no API was detected; their traffic will not be replayed. Configure web.api.paths and recordFrom.`);
}
```

Existing env-var inference, notes and evidence strings stay exactly as they are.
