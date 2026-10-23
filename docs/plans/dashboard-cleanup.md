# QA-06 dashboard design cleanup — plan

Findings from the rendered dashboard (all states seeded with real reports, 1280px and 375px):

| # | Finding | Fix |
| --- | --- | --- |
| 1 | `#status` is a chip wrapping the badge chip (pill in pill); `error` and `fail` share red | Bare `#status` container; status chip = icon + word; `error` uses warning tone |
| 2 | Current activity list unbounded (dozens of rows push everything off-screen) | Height-capped, focusable `.scroll-region` |
| 3 | Runner error tail loses line breaks, red prose | Pre-wrapped monospace banner, hidden when empty |
| 4 | History `<ol>` numbers clipped at 1000+ events | Unnumbered list with time/side columns |
| 5 | Stack paragraphs double the spacing (identity/updated gaps) | Zero margins inside stacks; tokens for gaps |
| 6 | Loading: blank selects, headless empty table, enabled Run button | Loading text, disabled submit, table hidden while empty |
| 7 | Empty: "Compare against main" without a project; table header over "No runs yet" | Guidance text + dashed empty states linking to Configurations |
| 8 | Mobile run table collapses to 1–2 words per line | Rows stack into a two-row grid at ≤600px |
| 9 | Run table row height driven by long error text | Activity clamped to 2 lines (full text kept in DOM/title) |
| 10 | No active navigation indicator; header noise; oversized hero | Sticky glass app bar, pill nav with `aria-current`, display-size h1 |
| 11 | Every button primary, Delete included; Apply/Read full-width | Secondary/danger button variants, aligned editor action bar |
| 12 | Coverage statuses are plain text | Toned chips (word kept) |

Not in scope: dark-mode toggle, backlog controls (QA-08..21), server changes.

Execution: `/handoff` with two coders — `markup` (HTML+CSS) and `behavior` (JS) — against
`dashboard-cleanup-contracts.md`. Coordinator owns the integration test and verification.
