#!/usr/bin/env bash
# Streams a read-only PostgreSQL dump into age. No plaintext dump on disk.
set -euo pipefail
config_dir=${1:?Usage: backup.sh CONFIG_DIR RECIPIENTS_FILE BACKUP_DIR [S3_URI]}
recipients=${2:?age public recipients file required}
backup_dir=${3:?backup directory required}
s3_uri=${4:-}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for tool in docker age sha256sum flock; do command -v "$tool" >/dev/null; done
if [[ -n "$s3_uri" ]]; then
  [[ "$s3_uri" == s3://* ]] || { echo 'Expected s3://bucket/prefix' >&2; exit 1; }
  command -v aws >/dev/null
fi
[[ -s "$recipients" ]] || { echo 'Missing public age recipients' >&2; exit 1; }
umask 077
mkdir -p -- "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
temp=$(mktemp "$backup_dir/.dump.XXXXXX")
trap 'rm -f -- "$temp"' EXIT
bash "$script_dir/compose.sh" "$config_dir" exec -T postgres sh -c '
  export PGPASSWORD="$BACKUP_DB_PASSWORD"
  exec pg_dump -h 127.0.0.1 -U meningfermam_backup -d meningfermam --format=custom
' | age --encrypt --recipients-file "$recipients" > "$temp"
file="$backup_dir/meningfermam-$(date -u +%Y%m%dT%H%M%SZ)-${temp##*.}.dump.age"
mv -- "$temp" "$file"
(cd -- "$backup_dir" && sha256sum "${file##*/}" > "${file##*/}.sha256")
if [[ -n "$s3_uri" ]]; then
  aws s3 cp "$file" "${s3_uri%/}/" --sse AES256 --only-show-errors
  aws s3 cp "$file.sha256" "${s3_uri%/}/" --sse AES256 --only-show-errors
fi
# Retention is explicit in the bucket policy; never delete the only local copy.
echo "Encrypted backup: $file"
