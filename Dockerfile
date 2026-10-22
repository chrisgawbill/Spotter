# Playwright's image ships Node, git and a matching Chromium.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN npm install -g pnpm@12.14.0 && mkdir -p /tmp/home && chmod 1777 /tmp/home

WORKDIR /opt/spotter
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Source and local project configs are bind-mounted by bin/spotter.
# Private project configs must never be baked into the image.
COPY src ./src
RUN mkdir -p projects

ENV SPOTTER_HOME=/data HOME=/tmp/home
ENTRYPOINT ["node", "/opt/spotter/src/cli.mjs"]
