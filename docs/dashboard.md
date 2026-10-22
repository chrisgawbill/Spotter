# Spotter dashboard (QA-06)

The dashboard reads existing `report.json` files and displays portable HTML
reports inside the page, including findings, check results, screenshots and
before/after/diff review. New CLI and dashboard runs also write `activity.json`
and append-only `activity.jsonl` events. The page polls every two seconds;
current work includes the comparison side, check, route, viewport, scheme,
session and injected endpoint where applicable. The last runner update and
last browser refresh are shown separately.

## Start on this server

Rebuild the image once for the shared Aero stylesheet dependency:

```bash
bin/spotter build-image
export SPOTTER_TAILSCALE_IP="$(tailscale ip -4)"
bin/spotter dashboard
```

Open `http://<tailscale-ip>:8089`. The server refuses to start without an
explicit address in Tailscale's `100.64.0.0/10` range. It binds that address
only; it never listens on a public or wildcard address. Apply tailnet ACLs to
8089 and, if using Caddy, 8088. There is no application sign-in; anyone allowed
by those ACLs can read reports and start configured project commands.

For the existing port-8088 entrypoint, start the dashboard and use
`deploy/Caddyfile` from [pipeline setup](pipeline.md). Existing report URLs
continue to work; other paths proxy to the dashboard on the Tailscale address
at port 8089. Both listeners must stay on the Tailscale interface. Run controls
require same-origin JSON and a recognized Host; reports are sandboxed and
cannot execute scripts. Fixtures and baseline/work directories are not served.

Copy `examples/deploy/` into the ignored local `deploy/` directory first.
A sample systemd unit is in `examples/deploy/spotter-dashboard.service`. Adjust its user,
paths, Tailscale IP and environment to match the server, then install it under
`/etc/systemd/system/` and enable it with `systemctl enable --now
spotter-dashboard`. It uses the existing Docker image and runs as the repository
owner, who needs Docker access. Adding the unit does not install or activate it.
Jenkins activation remains QA-03 work.

For automatic startup without installing a system service, build the image,
stop any manually launched dashboard so port 8089 is free, then run once:

```bash
bash deploy/start-dashboard
```

Docker's `unless-stopped` policy restarts the named `spotter-dashboard`
container after failures and server reboots (Docker must start at boot).
It retries if the Tailscale address is not yet available. It stays idle between requests. Open
`http://<tailscale-ip>:8089`; no terminal command is needed after installation.
Use `docker logs spotter-dashboard` for logs and `docker restart spotter-dashboard`
to restart it. An intentional `docker stop spotter-dashboard` keeps it stopped
across reboots until `docker start spotter-dashboard`. Use either this container
or the systemd unit, never both. Jenkins launches its own
short-lived runner containers and does not depend on the dashboard service.

## Run behavior

Select a configured project and an existing local or remote branch. Starting a
run opens its activity page, which remains addressable after a reload. Project and branch lists refresh automatically every two seconds, including
branch additions and deletions; valid selections are preserved. No fetch or
checkout mutation occurs: branches reflect the server's current repository
refs. Remote additions/deletions appear after the server repository is fetched
with pruning (`git fetch --all --prune`). Dashboard runs execute the normal CLI inside the same container, using
the same mounted repositories, fixtures and output directory. Preparation and
runner failures show an error and the final log tail even without a report.
Only one dashboard-triggered run is allowed at a time; CLI/Jenkins runs remain
independent. Avoid running other writers against the same baseline cache at
the same time.

The overview shows the latest 50 runs per configured project. Older runs stay
on disk and remain accessible by their activity URL. Historical runs without
activity metadata show their report result; their start time is unavailable.
Runners refresh their heartbeat every five seconds. A run without a report
becomes an error after 30 seconds without a heartbeat, including after a
container/server restart. Inspect runner logs before restarting a stalled run.
Auto-refreshing screenshots and live video are deferred.

## Verification

```bash
npm test
docker run --rm --init --ipc host \
  -v "$PWD/src:/opt/spotter/src:ro" \
  -v "$PWD/integration:/opt/spotter/integration:ro" \
  --entrypoint node spotter:latest --test integration/dashboard.test.mjs
```

The browser check starts real healthy and seeded runs, follows live check and
browser events, waits for pass/fail status, reloads a run, opens screenshots and
diffs inside the report, and checks the mobile layout. It creates an isolated
project config inside the disposable container; do not mount production configs
for this test. Preview screenshots are written under `/tmp` in the container.

## Project configurations

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

Configuration editor verification (2026-10-22): all 32 unit/HTTP tests pass.
The Docker browser regression covers create/edit/delete, contextual field and
YAML-cursor suggestions, desktop/mobile layouts and the existing run/report flow.
The real main run retains exactly the accepted 17 finding groups; the seeded
branch retains seven new groups, 17 existing and zero fixed, with identical
finding IDs to the accepted reports. Evidence:
`~/spotter/hockeystats-webapp/runs/20261022-211425-main-aa4e17d8/report.md` and
`~/spotter/hockeystats-webapp/runs/20261022-211426-verify-browser-depth-defects-3d99e273/report.md`.
