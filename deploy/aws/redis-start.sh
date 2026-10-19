#!/bin/sh
set -eu
: "${REDIS_PASSWORD:?}"
# Generator only emits hex; don't allow config-line injection on manual edits.
case "$REDIS_PASSWORD" in *[!a-f0-9]*|'') echo 'Invalid Redis password format' >&2; exit 1;; esac
[ "${#REDIS_PASSWORD}" -ge 64 ] || exit 1
umask 077
cat > /data/riizq.conf <<EOF
bind 0.0.0.0
protected-mode yes
requirepass $REDIS_PASSWORD
appendonly yes
appendfsync everysec
dir /data
maxmemory 256mb
maxmemory-policy noeviction
EOF
chown redis:redis /data/riizq.conf
exec /usr/local/bin/docker-entrypoint.sh redis-server /data/riizq.conf
