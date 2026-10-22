# Run Spotter on your own server

Spotter is a standalone repository. It does not need the original developer's
home directory, Jenkins, or Caddy to run the dashboard and QA commands.

## Install

Use a Linux server with Git, Bash, Docker Engine, and Tailscale. Give your
account Docker access and enable Docker and Tailscale at boot. Join the server
and your browser device to the same tailnet. The server needs network access
to the container and npm registries and your projects' dependency sources.

1. Clone this repository, preferably into `~/projects/Spotter`.
2. Clone projects you want to check under `~/projects`.
3. Create local configuration from the public examples:

   ```bash
   mkdir -p projects deploy
   cp examples/project.yml projects/my-app.yml
   cp examples/deploy/* deploy/
   ```

   Edit `projects/my-app.yml`: `repo` must be an absolute path on your server;
   set the actual base branch, install/check/build commands and routes.
   `projects/` and `deploy/` are ignored by Git. Keep real configs, deployment
   settings and credentials there; only generic examples belong in GitHub.
4. Build the image and start the dashboard:

   ```bash
   bin/spotter build-image
   bash deploy/start-dashboard
   ```

Open `http://<server-tailscale-ip>:8089`. The launcher gets the address from
`tailscale ip -4`; set `SPOTTER_TAILSCALE_IP` explicitly if needed. Dashboard
access is Tailscale-only; allow port 8089 in your tailnet ACLs. Anyone allowed
to access it can start QA runs and edit project configurations, including their
shell commands. Grant access to trusted project maintainers.

Projects outside `~/projects` need `SPOTTER_PROJECTS_ROOT` set to a common
parent directory when starting the dashboard. Use `SPOTTER_HOME` to change
the results directory (default `~/spotter`). These values are captured when
the container is created. For projects with `web.api`, record their API
fixtures with `bin/spotter record <project>` before running QA.

## Automatic startup and updates

The `spotter-dashboard` container uses Docker's `unless-stopped` restart policy:
it starts after server reboots and restarts after failures. Docker must itself
start at boot. No terminal session needs to stay open. The dashboard refreshes remote Git branches every minute; QA workers run only
when requested. Its projects mount is writable so Git can update remote refs.

```bash
docker logs --tail 50 spotter-dashboard
docker restart spotter-dashboard
```

An intentional `docker stop spotter-dashboard` leaves it stopped across reboots
until `docker start spotter-dashboard`. Use this container or the optional
systemd service, never both on the same port.

After updating the repository, rebuild the image if dependencies changed.
Recreate the container to use a rebuilt image or different environment:

```bash
docker stop spotter-dashboard
docker rm spotter-dashboard
bash deploy/start-dashboard
```

Wait for active dashboard runs to finish before stopping it. Results persist
outside the container in `SPOTTER_HOME`; recreating it keeps those results.
Back up that directory separately. Recorded fixtures and reports stay outside
the Git repository by default.

Jenkins is optional. The included [pipeline guide](pipeline.md) explains job
and webhook setup. Jenkins starts independent short-lived runner containers;
it does not need the dashboard process. Use the same `SPOTTER_HOME` to show
Jenkins results in the dashboard.

## Publish your copy to GitHub

Create an empty GitHub repository and commit the Spotter source and generic
examples. Keep your local `projects/`, `deploy/` and root `Jenkinsfile` out of
commits. Check `git diff --cached --name-only` before pushing. Add your own
repository URL as `origin` if needed; for example:

```bash
git remote add origin git@github.com:YOUR-ACCOUNT/Spotter.git
git push -u origin HEAD
```

Other users can clone that repository and follow the installation steps above.
The `private` field in `package.json` prevents accidental npm publication; it
does not prevent sharing the repository or building the Docker image.
