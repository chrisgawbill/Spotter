# Playwright's image ships Node, git and a matching Chromium.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN npm install -g pnpm@12.14.0 && mkdir -p /tmp/home && chmod 1777 /tmp/home

WORKDIR /opt/spotter
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# src/ and projects/ are bind-mounted by bin/spotter so code and config
# changes apply without rebuilding; the copies here make the image usable alone.
COPY src ./src
COPY projects ./projects

ENV SPOTTER_HOME=/data HOME=/tmp/home
ENTRYPOINT ["node", "/opt/spotter/src/cli.mjs"]
