#!/bin/sh
# Monthly restore test: restores the latest encrypted backup into a SCRATCH
# database, runs sanity checks and drops it again. A non-zero exit means the
# backup cannot be trusted — treat it as an incident.
#
#   PGHOST=restore-test.internal PGUSER=restore_tester PGSSLMODE=verify-full \
#   PGPASSFILE=/etc/meningfermam/restore.pgpass \
#   AGE_IDENTITY_FILE=/secure/backup-identity.txt \
#   BACKUP_S3_URI=s3://meningfermam-backups/postgres \
#     scripts/db/restore-test.sh
#
# Never point PGHOST at production: the scratch database is created and
# dropped here. Connection settings come from libpq env, the password from
# PGPASSFILE — nothing secret on argv. See docs/operations/backup-restore.md.
set -eu

: "${PGHOST:?PGHOST majburiy (scratch server, production EMAS)}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE majburiy (age private kalit fayli)}"
RESTORE_DB="${RESTORE_DB:-meningfermam_restore_test}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-26}"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/../../prisma/migrations}"

case "$RESTORE_DB" in
  *restore*) ;;
  *)
    echo "XATO: RESTORE_DB nomida 'restore' bo‘lishi shart (xavfsizlik uchun)" >&2
    exit 1
    ;;
esac

for tool in pg_restore psql createdb dropdb age sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "XATO: $tool topilmadi" >&2
    exit 1
  }
done

umask 077
started="$(date +%s)"
cleanup() {
  rm -rf "$WORK_DIR"
  if [ "${KEEP_DB:-false}" != "true" ]; then
    dropdb --if-exists --maintenance-db=postgres "$RESTORE_DB" || true
  fi
}
trap cleanup EXIT INT TERM

# 1. Pick the backup: BACKUP_FILE, or the newest object under BACKUP_S3_URI.
if [ -n "${BACKUP_FILE:-}" ]; then
  backup="$BACKUP_FILE"
else
  : "${BACKUP_S3_URI:?BACKUP_FILE yoki BACKUP_S3_URI majburiy}"
  latest="$(aws s3 ls "$BACKUP_S3_URI/" | awk '{print $4}' | grep '\.dump\.age$' | sort | tail -n 1)"
  [ -n "$latest" ] || {
    echo "XATO: $BACKUP_S3_URI da backup topilmadi" >&2
    exit 1
  }
  backup="$WORK_DIR/$latest"
  aws s3 cp "$BACKUP_S3_URI/$latest" "$backup" --only-show-errors
  aws s3 cp "$BACKUP_S3_URI/$latest.sha256" "$backup.sha256" --only-show-errors
fi
echo "Backup: $(basename "$backup")"

# 2. Integrity: checksum written at backup time.
if [ -f "$backup.sha256" ]; then
  (cd "$(dirname "$backup")" && sha256sum -c "$(basename "$backup").sha256")
else
  echo "XATO: $backup.sha256 topilmadi" >&2
  exit 1
fi

# 3. Decrypt and restore into a fresh scratch database. Roles of the
# production cluster may not exist here, so owners/ACLs are not restored.
dropdb --if-exists --maintenance-db=postgres "$RESTORE_DB"
createdb --maintenance-db=postgres "$RESTORE_DB"
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$WORK_DIR/restore.dump" "$backup"
pg_restore --dbname="$RESTORE_DB" --no-owner --no-acl --exit-on-error \
  --jobs="${RESTORE_JOBS:-2}" "$WORK_DIR/restore.dump"
rm -f "$WORK_DIR/restore.dump"

# 4. Sanity checks. Each query returns 't' when the check passes.
fail=0
check() {
  result="$(psql --dbname="$RESTORE_DB" -X -A -t -v ON_ERROR_STOP=1 -c "$2")"
  if [ "$result" = "t" ]; then
    echo "  OK    $1"
  else
    echo "  XATO  $1" >&2
    fail=1
  fi
}

expected_migrations=0
if [ -d "$MIGRATIONS_DIR" ]; then
  expected_migrations="$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
fi

echo "Tekshiruvlar:"
check "barcha migratsiyalar qo‘llangan (>= $expected_migrations)" \
  "SELECT count(*) >= $expected_migrations AND bool_and(finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM _prisma_migrations"
check "kamida bitta faol (demo bo‘lmagan) SUPER_ADMIN bor" \
  "SELECT EXISTS (SELECT 1 FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND NOT is_demo)"
check "ombor qoldig‘i manfiy emas" \
  "SELECT NOT EXISTS (SELECT 1 FROM inventory_items WHERE quantity < 0)"
check "ombor qoldig‘i oxirgi harakat balansiga teng" \
  "SELECT NOT EXISTS (SELECT 1 FROM inventory_items i JOIN LATERAL (SELECT balance_after FROM stock_movements m WHERE m.item_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1) last ON true WHERE last.balance_after <> i.quantity)"
check "append-only triggerlar joyida" \
  "SELECT count(*) = 3 FROM pg_trigger WHERE tgname IN ('audit_logs_append_only', 'stock_movements_append_only', 'treatment_doses_append_only')"
check "CHECK constraint’lar joyida" \
  "SELECT count(*) = 2 FROM pg_constraint WHERE conname IN ('inventory_items_quantity_non_negative_chk', 'medicines_demo_not_approved_chk')"
check "backup yangi (oxirgi audit yozuvi $MAX_BACKUP_AGE_HOURS soatdan yosh)" \
  "SELECT max(timestamp) > now() AT TIME ZONE 'UTC' - interval '$MAX_BACKUP_AGE_HOURS hours' FROM audit_logs"

elapsed=$(( $(date +%s) - started ))
if [ "$fail" -ne 0 ]; then
  echo "Restore test MUVAFFAQIYATSIZ (${elapsed}s)" >&2
  exit 1
fi
echo "Restore test muvaffaqiyatli: ${elapsed}s (RTO o‘lchovi sifatida qayd eting)"
