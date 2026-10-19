#!/bin/sh
set -e

# node_modules lives in a named volume, so it does not pick up dependency
# changes from a rebuilt image. Re-install only when package files changed.
# The monorepo root is mounted at /repo; the lockfile lives there.
DEPS_HASH="$(cat /repo/package.json /repo/package-lock.json /repo/apps/backend/package.json | sha256sum)"
if [ "$(cat /repo/node_modules/.deps-hash 2>/dev/null)" != "$DEPS_HASH" ]; then
  echo "Dependency o‘zgarishi aniqlandi, npm ci bajarilmoqda..."
  (cd /repo && npm ci --workspace apps/backend --no-audit --no-fund)
  echo "$DEPS_HASH" > /repo/node_modules/.deps-hash
fi

# The bind mount hides the client generated at build time.
npx prisma generate

echo "PostgreSQL kutilmoqda..."
until npx prisma db execute --stdin <<SQL
SELECT 1;
SQL
do
  sleep 2
done

echo "Migratsiyalar bajarilmoqda..."
npx prisma migrate deploy

if [ "${DEMO_ACCOUNTS_ENABLED:-false}" = "true" ]; then
  echo "Development seed bajarilmoqda..."
  npm run db:seed
fi

echo "NestJS development server ishga tushmoqda..."
exec npm run start:watch
