#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
printf 'Building the currently checked-out source; no remote changes are fetched.\n'
./scripts/backup.sh
docker compose build
docker compose up -d --wait
printf 'Update complete. Existing settings and persistent storage preserved.\n'
