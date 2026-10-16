#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
printf 'Updating the configured image or currently checked-out source.\n'
./scripts/backup.sh
./scripts/start.sh
printf 'Update complete. Existing settings and persistent storage preserved.\n'
