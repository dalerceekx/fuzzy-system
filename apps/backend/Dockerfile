# syntax=docker/dockerfile:1
#
# Production image of the backend. Build context = monorepo root (the single
# workspace lockfile lives there):
#
#   docker build -f apps/backend/Dockerfile -t meningfermam-api:<git-sha> .
#
# Stages: deps (all deps) → build (dist/) → prod-deps (npm ci --omit=dev)
# → runner (dist + production node_modules only; no sources, tests, seed,
# .env or package managers). Secrets are never baked in: they come from the
# runtime environment (see compose.prod.yaml and docs/operations/secrets.md).

ARG NODE_IMAGE=node:22.23.3-alpine3.24

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
# Workspace manifests + lockfile only. The frontend manifest is needed so
# `npm ci` accepts the workspace lockfile; frontend deps are not installed.
COPY package.json package-lock.json .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
# The backend `postinstall` hook runs `prisma generate`.
COPY apps/backend/prisma.config.ts apps/backend/
COPY apps/backend/prisma/schema.prisma apps/backend/prisma/
RUN npm ci --workspace apps/backend --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo/apps/backend
COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json apps/backend/nest-cli.json ./
COPY apps/backend/src ./src
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/prisma.config.ts apps/backend/
COPY apps/backend/prisma/schema.prisma apps/backend/prisma/
# Install scripts stay enabled: @prisma/engines fetches the schema engine
# that `prisma migrate deploy` needs at release time.
RUN npm ci --workspace apps/backend --omit=dev --no-audit --no-fund \
  && mkdir -p apps/backend/node_modules

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner

LABEL org.opencontainers.image.title="meningfermam-api" \
      org.opencontainers.image.description="Mening Fermam backend API" \
      org.opencontainers.image.licenses="UNLICENSED"

ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# Fixed numeric UID/GID (matches `user:` in compose.prod.yaml). Package
# managers are removed: nothing is installed at runtime, and the prisma CLI
# comes from node_modules.
RUN addgroup -S -g 10001 app \
  && adduser -S -D -H -u 10001 -G app -s /sbin/nologin app \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

WORKDIR /app/apps/backend

# Files stay owned by root and read-only for the runtime user; the app writes
# nothing to disk (uploads go to S3, logs to stdout, /tmp is a tmpfs).
COPY --from=prod-deps /repo/node_modules /app/node_modules
COPY --from=prod-deps /repo/apps/backend/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./dist
COPY apps/backend/package.json apps/backend/prisma.config.ts ./
COPY apps/backend/prisma/schema.prisma ./prisma/schema.prisma
COPY apps/backend/prisma/migrations ./prisma/migrations
# Disease reference source text (reference data, not demo data), loaded by
# `node dist/cli/seed-diseases.js` — resolved as ../../prisma/data from dist/.
COPY apps/backend/prisma/data/kasalliklar-manba.txt ./prisma/data/kasalliklar-manba.txt
COPY apps/backend/docker/prod-entrypoint.sh ./docker/prod-entrypoint.sh

USER 10001:10001

EXPOSE 3001
STOPSIGNAL SIGTERM

# Liveness only (no dependency probes): a DB outage must not make the
# orchestrator kill every API container at once.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["sh", "./docker/prod-entrypoint.sh"]
CMD ["serve"]
