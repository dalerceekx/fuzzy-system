#!/usr/bin/env bash
# Run on the AWS host after DNS/S3/Eskiz setup. Does not create AWS resources.
set -euo pipefail
config_dir=${1:?Usage: release.sh CONFIG_DIR}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
compose=(bash "$script_dir/compose.sh" "$config_dir")
"${compose[@]}" config --quiet
# Images are built/pulled separately, before touching the running services.
"${compose[@]}" run --rm --no-deps api check-env
"${compose[@]}" up -d --wait --wait-timeout 120 postgres redis
"${compose[@]}" run --rm migrate
"${compose[@]}" run --rm --no-deps api node dist/cli/seed-diseases.js
"${compose[@]}" up -d --wait --wait-timeout 180 api
"${compose[@]}" exec -T api node -e \
  "fetch('http://127.0.0.1:3001/api/v1/health').then(async r => {if (!r.ok || (await r.json()).status !== 'ok') process.exit(1)}, () => process.exit(1))"
"${compose[@]}" up -d --wait --wait-timeout 120 web
echo 'Containers and dependencies healthy. Verify public HTTPS and /api/v1/health.'
