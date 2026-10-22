# Pipeline and hosted reports (QA-03)

Use one Jenkins Pipeline job per configured project on this server. The agent
needs label `spotter`, Git, Bash and access to the Docker daemon, the project's
Git repository, and the Spotter data directory. Build the Spotter image first
(`bin/spotter build-image`) and record fixtures before enabling pushes.

Load `Jenkinsfile` from this Spotter repository using Pipeline script from SCM.
Install the Jenkins Git, Pipeline and Generic Webhook Trigger plugins. Configure
PROJECT, PROJECT_GIT_URL and DEFAULT_BRANCH with Build with Parameters;
these values are retained as defaults for subsequent webhook builds. REF stays
empty by default. Use a trusted project repository. Private repositories require the job's Git credentials in the
checkout's `userRemoteConfigs.credentialsId`. Keep one job per project: runs
are serialized so copying `runs/latest` captures this job's report.

Create a Jenkins Secret Text credential named `spotter-<project>-webhook-token` containing
a distinct random webhook token for this project. Bootstrap the job once to register parameters (the empty repository URL stops
it before checkout), then run Build with Parameters using a non-default REF
to save project settings and register the trigger.
Configure the project repository's push webhook to POST JSON to
`https://<jenkins>/generic-webhook-trigger/invoke?token=<token>` (protect this
URL like a credential). The payload's `ref` selects the pushed branch. Default
branch pushes, tags and deletion payloads (`deleted: true`) do not produce QA runs; other branch pushes check the fetched head against the default
branch merge base. REF overrides the payload for manual runs. The project
config's `baseBranch` must agree with DEFAULT_BRANCH. Credentials and optional
PR comments are not configured by Spotter; PR comments remain disabled.

Each completed run archives the whole `spotter-report/` directory, even when
findings fail the build. Open `report.md` for action and `report.html` for visual
review; extract the entire archive to retain relative image links. Visual
changes are advisory and never change the exit code. Pixel comparisons include
all saved visits (including session/fault variants); additions, removals and
resizes are listed. Exact decoded pixels are compared without a threshold;
animations, clocks and recorded responses use the normal deterministic sweep.
Dynamic content can still require human review.

## Caddy on Tailscale port 8088

Run Caddy on the same server with `deploy/Caddyfile`. Set SPOTTER_TAILSCALE_IP
to the server's Tailscale IPv4 address and SPOTTER_HOME to the absolute directory
holding project runs (normally `/home/chris_dev/spotter`). Grant its service
user read/traverse permission for that directory. Validate before reloading:

```bash
caddy validate --config deploy/Caddyfile --adapter caddyfile
caddy run --config deploy/Caddyfile --adapter caddyfile
```

Open `http://<tailscale-ip>:8088/<project>/runs/latest/report.html`.
Caddy binds only the configured Tailscale address. Project run paths retain
static hosting; other requests proxy to the [dashboard](dashboard.md) on the
same Tailscale address at port 8089. Fixtures, baseline caches and working
exports return 404. Start the dashboard before using its pages. Apply your
Tailscale ACL to port 8088. Reports/screenshots/logs can contain project data;
restrict access to reviewers. Caddy follows the `latest` symlink inside each
project's runs directory. Historical timestamped runs remain addressable.

No Jenkins job, webhook or Caddy service is installed by adding these files.
Deployment requires access to the server's Jenkins and Caddy configuration.

References: [Jenkins webhook trigger](https://plugins.jenkins.io/generic-webhook-trigger),
[Caddy request matchers](https://caddyserver.com/docs/caddyfile/matchers).
