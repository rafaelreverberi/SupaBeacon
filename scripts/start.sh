#!/usr/bin/env bash
# Start either the configured registry image or the local source build.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { printf 'Missing .env; run ./setup.sh first.\n' >&2; exit 1; }
if awk -F= '$1=="SUPABEACON_IMAGE" && length($2)>0 {found=1} END {exit !found}' .env; then
  docker compose pull
  docker compose up -d --no-build --wait
else
  docker compose up -d --build --wait
fi
