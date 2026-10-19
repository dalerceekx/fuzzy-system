#!/bin/sh
# Development-only PostgreSQL bootstrap (runs once, when the data volume is
# created). Mirrors the production layout described in
# docs/operations/database.md:
#   - `postgres` (POSTGRES_USER) owns the schema and runs migrations;
#   - `meningfermam_app` is the least-privilege runtime role (DML only; the
#     grants are applied by the security_foundation migration when the
#     role exists);
#   - `meningfermam_test` is the database for e2e tests.
# Existing volumes are not touched: `npm run dev:reset` recreates them.
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD majburiy}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE meningfermam_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meningfermam_app')
\gexec

ALTER ROLE meningfermam_app SET timezone TO 'UTC';
ALTER DATABASE :"DBNAME" SET timezone TO 'UTC';

-- Nobody but the owner may create objects in the public schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO meningfermam_app;

SELECT 'CREATE DATABASE meningfermam_test'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'meningfermam_test')
\gexec
ALTER DATABASE meningfermam_test SET timezone TO 'UTC';
SQL
