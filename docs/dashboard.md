# Spotter dashboard

The dashboard reads existing `report.json` files and displays portable HTML
reports inside the page, including findings, check results, screenshots and
before/after/diff review. New CLI and dashboard runs also write `activity.json`
and append-only `activity.jsonl` events. The page polls every two seconds;
current work includes the comparison side, check, route, viewport, scheme,
session and injected endpoint where applicable. The last runner update and
last browser refresh are shown separately.

A run's checklist lists each section as the branch run reaches it (export,
static checks with each check, rules, browser sweep with its build and each
route, specs, comparison) and marks it done, in progress or not finished, with
its duration. The **Now** panel shows the current section, browser sweep
progress and the merge-base status; the full event log stays available below.
Per-section finding counts are not shown during a run; use the report.
Above the embedded report, **Report**, **Markdown** and **JSON** switch between
`report.html`, `report.md` and `report.json`; the choice is kept across runs.
**Copy** copies the whole report in the format shown, and **Open in a new tab**
opens that format. Copying also works over the plain-http Tailscale address.
**Download PDF** saves the HTML report as a PDF, rendered on the server with the
image's Chromium (scripts off, only files from that run folder).
The embedded HTML view omits the report's own Markdown · JSON · Logs links;
the standalone `report.html` keeps them.

## Start on this server

Build the image before the first start:

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

## Persistent container

For automatic startup without installing a system service, build the image,
stop any manually launched dashboard so port 8089 is free, then run once:

```bash
bash deploy/start-dashboard
```

Docker's `unless-stopped` policy restarts the named `spotter-dashboard`
container after failures and server reboots (Docker must start at boot).
It retries if the Tailscale address is not yet available. It refreshes remote Git branches every minute. Open
`http://<tailscale-ip>:8089`; no terminal command is needed after installation.
Use `docker logs spotter-dashboard` for logs and `docker restart spotter-dashboard`
to restart it. An intentional `docker stop spotter-dashboard` keeps it stopped
across reboots until `docker start spotter-dashboard`. Use either this container
or the systemd unit, never both. Jenkins launches its own
short-lived runner containers and does not depend on the dashboard service.

## Run behavior

Select a configured project, an existing local or remote branch and optionally a
testing level (Project default uses `levels.default`; Low is available only when
`levels.low` is configured). The plan preview below the form shows what the run
will execute and exclude before you start it. For a project with `web.api`, it
also shows **Record API fixtures first** with the exact `bin/spotter record`
command (and a Copy button) when no fixtures exist or the newest finished run
called endpoints missing from them. Recording starts the project's API, so it
runs only in a terminal on the server; the dashboard never runs it. Starting a
run opens its activity page, which remains addressable after a reload. Project and branch lists refresh automatically every two seconds, including
branch additions and deletions; valid selections are preserved. The server runs `git fetch --all --prune --no-tags` at startup and every minute,
even with no browser open. This updates remote-tracking refs without changing
checked-out files or local branches. Deleted remote branches disappear as
`origin/<branch>`; separately retained local branches remain selectable. Fetch
failures keep cached branches and show a warning; the next minute retries.
Private remotes need noninteractive Git credentials available inside the
container. For SSH remotes, start with `SPOTTER_SSH_DIR="$HOME/.ssh" bash
deploy/start-dashboard` (also supported by `bin/spotter dashboard`). This mounts
the chosen SSH directory and host user/group definitions read-only; use a
dedicated directory with a read-only deploy key and trusted `known_hosts` where
possible. The key must work without an interactive passphrase prompt. Dashboard containers require a writable projects mount for Git refs;
recreate older containers with the updated startup template (or CLI wrapper).
A finished run is PASS, FAIL or INCOMPLETE; INCOMPLETE runs list the coverage
gaps beside the status, and every run shows the same one-line coverage summary
and coverage notes (such as fixtures that hold no data) as `report.md` (see [coverage and completeness](../README.md#coverage-and-completeness)).
Dashboard runs execute the normal CLI inside the same container, using
the same mounted repositories, fixtures and output directory. Preparation and
runner failures show an error and the final log tail even without a report.
Only one dashboard-triggered run is allowed at a time; CLI/Jenkins runs remain
independent. Avoid running other writers against the same baseline cache at
the same time.

## History and interrupted runs

The overview shows the latest 50 runs per configured project. Older runs stay
on disk and remain accessible by their activity URL. Historical runs without
activity metadata show their report result; their start time is unavailable.
Runners refresh their heartbeat every five seconds. A run without a report
becomes an error after 30 seconds without a heartbeat, including after a
container/server restart. Inspect runner logs before restarting a stalled run.
Auto-refreshing screenshots and live video are deferred.

## Storage

**Storage** shows, per configured project, how many runs, cached base results
and work folders exist and how much disk each uses, plus what cleanup would
remove right now. Sizes are computed when the page opens or **Refresh** is
pressed, never on the two-second poll.

The settings (runs to keep, cached base results to keep, automatic cleanup
after each run) are saved to `retention.json` in the Spotter data folder. The
environment variables `SPOTTER_KEEP_RUNS`, `SPOTTER_KEEP_BASELINES` and
`SPOTTER_AUTO_PRUNE` override the saved file; a field they set is disabled and
names its variable. Command-line flags override both.

**Clean up now** deletes what the preview lists, using the saved settings, after
a confirmation. It is disabled when nothing would be removed or when the form
has unsaved changes. The latest run and runs in progress are always kept; while
a run is in progress for a project, its cached base results and work folders are
skipped and the page says so.

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

Use **Configurations** to create, edit or delete project YAML, or choose
**Set up from folder** to generate a draft. Review the draft before saving.
See [project configuration](project-configuration.md) for detection coverage,
precedence, editor behavior and mount requirements.
