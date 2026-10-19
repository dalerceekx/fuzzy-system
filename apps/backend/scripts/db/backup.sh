#!/bin/sh
# Encrypted logical backup of the Mening Fermam database.
#
#   PGHOST=… PGPORT=5432 PGUSER=meningfermam_backup PGDATABASE=meningfermam \
#   PGSSLMODE=verify-full PGPASSFILE=/etc/meningfermam/backup.pgpass \
#   AGE_RECIPIENTS_FILE=/etc/meningfermam/backup-recipients.txt \
#   BACKUP_S3_URI=s3://meningfermam-backups/postgres \
#     scripts/db/backup.sh
#
# Connection settings come from the standard libpq environment and the
# password from PGPASSFILE (or IAM auth) — never from argv, so it is not
# visible in `ps`. The dump is encrypted with `age` to PUBLIC recipient keys
# before it touches the disk; the private key is not on this host.
# See docs/operations/backup-restore.md.
set -eu

: "${PGHOST:?PGHOST majburiy}"
: "${PGDATABASE:?PGDATABASE majburiy}"
: "${AGE_RECIPIENTS_FILE:?AGE_RECIPIENTS_FILE majburiy (age public kalitlar fayli)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/meningfermam}"

for tool in pg_dump age sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "XATO: $tool topilmadi" >&2
    exit 1
  }
done

umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/${PGDATABASE}-${stamp}.dump.age"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT INT TERM

# Custom format (-Fc): compressed, selective/parallel pg_restore. Owners and
# grants stay in the dump; pg_restore decides (--no-owner/--no-acl) per target.
# `set -o pipefail` is not POSIX, so pg_dump's status is checked explicitly.
status_file="$tmp.status"
{
  pg_dump --format=custom --compress=9 || echo "$?" >"$status_file"
} | age --encrypt --recipients-file "$AGE_RECIPIENTS_FILE" --output "$tmp"
if [ -s "$status_file" ]; then
  rm -f "$status_file"
  echo "XATO: pg_dump muvaffaqiyatsiz tugadi" >&2
  exit 1
fi
rm -f "$status_file"

mv "$tmp" "$file"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" >"$(basename "$file").sha256")
echo "Backup tayyor: $file"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  command -v aws >/dev/null 2>&1 || {
    echo "XATO: aws CLI topilmadi" >&2
    exit 1
  }
  # The bucket enforces SSE-KMS, versioning and Object Lock; this host's IAM
  # role may only PutObject (no delete, no read).
  aws s3 cp "$file" "$BACKUP_S3_URI/" --sse aws:kms --only-show-errors
  aws s3 cp "$file.sha256" "$BACKUP_S3_URI/" --sse aws:kms --only-show-errors
  echo "S3 ga yuklandi: $BACKUP_S3_URI/$(basename "$file")"
fi

# Local copies are short-lived; the bucket's lifecycle policy keeps history.
find "$BACKUP_DIR" -name '*.dump.age*' -mtime +"${BACKUP_LOCAL_RETENTION_DAYS:-3}" -delete
