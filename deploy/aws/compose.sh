#!/usr/bin/env bash
set -euo pipefail
config_dir=${1:?Usage: compose.sh CONFIG_DIR [compose arguments...]}
shift
export RIIZQ_CONFIG_DIR
RIIZQ_CONFIG_DIR=$(cd -- "$config_dir" && pwd)
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec docker compose --env-file "$RIIZQ_CONFIG_DIR/compose.env" -f "$script_dir/compose.yaml" "$@"
