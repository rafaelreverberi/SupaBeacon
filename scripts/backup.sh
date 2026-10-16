#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
[[ -f .env ]] || { printf 'Missing .env.\n' >&2; exit 1; }
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="backups/supabeacon-$stamp.tar.gz"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
# SQLite online backup includes WAL data and produces a consistent snapshot.
docker compose exec -T supabeacon node --input-type=module -e 'import Database from "better-sqlite3"; const db=new Database(process.env.DATABASE_PATH);await db.backup("/app/data/backup.sqlite");db.close();'
docker compose cp supabeacon:/app/data/backup.sqlite "$temp/database.sqlite"
docker compose exec -T supabeacon node -e 'require("fs").unlinkSync("/app/data/backup.sqlite")'
cp .env "$temp/.env"
cat > "$temp/MANIFEST" <<MANIFEST
SupaBeacon backup v1
Created UTC: $stamp
Includes sensitive encryption material. Keep private.
MANIFEST
tar -czf "$backup_path" -C "$temp" .env database.sqlite MANIFEST
chmod 600 "$backup_path"
printf 'Backup created: %s (contains secrets; store securely)\n' "$backup_path"
