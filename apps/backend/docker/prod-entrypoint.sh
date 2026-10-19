#!/bin/sh
# Production entrypoint. Never seeds: demo data does not exist in production
# (prisma/seed.ts is not even in the image).
set -eu

# The prisma CLI from production node_modules (hoisted to the monorepo
# root inside the image); npm/npx are not installed in the runtime image.
prisma() {
  node "$(node -p "require.resolve('prisma/build/index.js')")" "$@"
}

case "${1:-serve}" in
  # Release command: run once per deploy, before new API containers start.
  #   docker compose -f compose.prod.yaml run --rm migrate
  # Uses MIGRATION_DATABASE_URL (schema owner) via prisma.config.ts.
  migrate)
    if [ -z "${MIGRATION_DATABASE_URL:-}" ]; then
      echo "XATO: migrate uchun MIGRATION_DATABASE_URL (schema egasi) majburiy." >&2
      exit 1
    fi
    echo "Migratsiyalar bajarilmoqda..."
    prisma migrate deploy
    ;;

  check-env)
    exec node dist/cli/check-production.js
    ;;

  serve)
    echo "NestJS production server ishga tushmoqda..."
    exec node dist/main.js
    ;;

  *)
    exec "$@"
    ;;
esac
