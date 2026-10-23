# Project configurations

Use **Configurations → Set up from folder** to browse folders on the server
under `SPOTTER_PROJECTS_ROOT` (default `~/projects`). Open the app folder that
contains `package.json`, then choose **Generate configuration**. When a selected
repository has exactly one immediate app subfolder, Spotter selects it automatically. Spotter detects
the repository, default branch, app subdirectory, npm/pnpm/Yarn/Bun install
command, common check scripts and Vite/Create React App static build defaults.
Route discovery identifies the frontend from dependencies and source: React
Router JSX/object routes, Vue Router and Angular route arrays (including relative
imports), and file-based pages in Next.js, Nuxt, SvelteKit and Astro. It joins
nested routes, recognizes hash URLs and excludes framework layouts, API handlers
and private pages. Apps that route on `location.hash` without a router library
get a `/#<value>` route for each string literal compared with or assigned to it
(including through a function parameter); routes assembled from expressions are
listed for concrete samples. Literal build base paths and output directories are detected
without executing project source. Next static exports, Nuxt generate, static
SvelteKit, Astro, Vue CLI and unambiguous Angular build output can also receive
browser-check drafts; server-only or unknown builds get setup guidance and a list
of detected URLs instead.

## Discovery limits

Dynamic parameters, catch-all paths, computed route lists, unresolved aliases,
lazy-loaded route fragments and custom file conventions require review and
concrete sample URLs. Discovery lists these gaps instead of inventing IDs.
The source scan is capped at 500 files and 1 MB per file and reports skipped or
unparseable source. It does not promise all runtime-generated routes.
The generated YAML opens in the existing editor; review it and click **Save
configuration**. Existing configurations are never overwritten by generation.

Detection reads Git metadata, package scripts/lockfiles, TypeScript config,
router/build source, public environment examples, CSS breakpoints, Playwright
settings and Spotter adapter specs. It selects known check parsers, adds Vitest
JSON reports, discovers API URL variables/fallbacks, plain theme-storage keys,
literal failure UI text, loading classes and retry-aware observation budgets.
Inferred values need review: source syntax cannot establish every runtime state.
Private `.env` and session-state files are not scanned, and generation never runs
project code, installs dependencies or records API requests.

Every dictionary option appears in the draft's coverage table as **preserved**,
**detected**, **inferred**, **default** or **review**, with evidence or next steps.
Runtime defaults are shown explicitly in new browser configs. Generation follows
the dictionary's own YAML examples for routes, arrays and compact mappings;
block and flow YAML remain equivalent input formats.

## Explicit settings and precedence

Portable explicit settings can live in `spotter.yml`, `.spotter.yml` or
`.spotter/config.yml` in the app folder, or the repository root with a matching
`workdir`. These settings override inference. Matching saved dashboard configs
have highest priority: one match is reused automatically; with several matches,
choose **Reuse <name>**. Existing commands, routes, policies, sessions, tuned
budgets and comments survive; generation fills missing settings and still waits
for **Save configuration**. Saving uses the existing stale-edit protection.

Projects without explicit policy/session settings show those fields for review;
the wizard does not invent policy exceptions, credentials or account IDs. Literal
navigation links can supply route/query samples; unresolved dynamic URLs remain
listed for review. Monorepos and unknown/server-only builds may need adjustments.
Folder browsing uses the mounted server root, not the browser device's folders.
Custom roots must be passed as `SPOTTER_PROJECTS_ROOT`; the launchers mount and
forward that path.

## Edit and save

Open **Configurations** to create, edit or delete `projects/<name>.yml`.
The basic form covers repository, base branch, working directory and install
command; its values can be applied to the full YAML editor. Saving automatically
applies changed basic fields. The YAML editor supports all other options and
preserves comments. A shared dictionary in `src/config-fields.mjs` supplies field
labels, types, contextual suggestions and examples for the documented options.
Guidance follows the YAML cursor for recognized fields; select any dictionary
entry to browse its examples.

Saves use the CLI's config validation and reject stale edits; reopen a config
if another writer changed it. Config changes wait until dashboard-triggered runs
finish. Delete requires confirmation and removes only the configuration, leaving
reports and fixtures on disk. Deleted projects disappear from the dashboard;
recreate their config to browse their old reports again. Unsaved edits survive
background refreshes and warn before closing the editor or browser tab.

The dashboard needs a writable projects mount. The CLI wrapper enables it for
`dashboard` only, and the persistent startup template uses `:rw`. Recreate an
existing dashboard container using the updated startup template to change its
mount permissions. Users with dashboard access can now edit shell commands that
future runs execute, so grant access only to trusted project maintainers.


See [dashboard setup](dashboard.md) for hosting and access controls.
