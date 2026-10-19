#!/bin/sh
# First boot of a NEW production volume only. No demo DB/data.
set -eu
: "${OWNER_DB_PASSWORD:?}" "${APP_DB_PASSWORD:?}" "${BACKUP_DB_PASSWORD:?}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv owner_password OWNER_DB_PASSWORD
\getenv app_password APP_DB_PASSWORD
\getenv backup_password BACKUP_DB_PASSWORD
SELECT format('CREATE ROLE meningfermam_owner LOGIN PASSWORD %L', :'owner_password') \gexec
SELECT format('CREATE ROLE meningfermam_app LOGIN PASSWORD %L', :'app_password') \gexec
SELECT format('CREATE ROLE meningfermam_backup LOGIN PASSWORD %L', :'backup_password') \gexec
ALTER DATABASE meningfermam OWNER TO meningfermam_owner;
ALTER SCHEMA public OWNER TO meningfermam_owner;
REVOKE ALL ON DATABASE meningfermam FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE meningfermam TO meningfermam_app, meningfermam_backup;
GRANT USAGE ON SCHEMA public TO meningfermam_app, meningfermam_backup;
GRANT pg_read_all_data TO meningfermam_backup;
ALTER DATABASE meningfermam SET timezone TO 'UTC';
ALTER ROLE meningfermam_app SET timezone TO 'UTC';
ALTER ROLE meningfermam_app SET statement_timeout = '15s';
ALTER ROLE meningfermam_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE meningfermam_app CONNECTION LIMIT 50;
SQL
