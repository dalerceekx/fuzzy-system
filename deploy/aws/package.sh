#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$root"
umask 077
mkdir -p .deploy/releases
archive=".deploy/releases/riizq-source-$(date -u +%Y%m%dT%H%M%S%N).tar.gz"
# Explicit source paths: private config is transported separately, never here.
tar --exclude='.env*' --exclude=node_modules --exclude=dist --exclude=coverage \
  --exclude=generated --exclude='*.tsbuildinfo' --exclude=uploads --exclude=backups \
  --exclude='*.pem' --exclude='*.key' --exclude='*.dump' --exclude='*.log' \
  -czf "$archive" \
  package.json package-lock.json .npmrc .dockerignore .gitignore .prettierrc README.md \
  apps/backend/Dockerfile apps/backend/README.md apps/backend/compose.prod.yaml \
  apps/backend/package.json apps/backend/prisma.config.ts \
  apps/backend/tsconfig.json apps/backend/tsconfig.build.json apps/backend/nest-cli.json \
  apps/backend/vitest.config.ts apps/backend/vitest.config.e2e.ts \
  apps/backend/src apps/backend/prisma apps/backend/docker apps/backend/test \
  apps/backend/docs apps/backend/scripts \
  apps/frontend/Dockerfile apps/frontend/Dockerfile.dockerignore apps/frontend/Caddyfile \
  apps/frontend/README.md apps/frontend/package.json apps/frontend/tsconfig.json apps/frontend/tsconfig.app.json \
  apps/frontend/tsconfig.node.json apps/frontend/vite.config.ts apps/frontend/index.html \
  apps/frontend/src apps/frontend/public apps/frontend/scripts apps/frontend/caddy \
  deploy/aws
(cd .deploy/releases && sha256sum "${archive##*/}" > "${archive##*/}.sha256")
echo "$archive"
