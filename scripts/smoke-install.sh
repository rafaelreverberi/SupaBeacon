#!/usr/bin/env bash
# Disposable installation acceptance test; never touches the normal project volume.
set -euo pipefail
cd "$(dirname "$0")/.."
source_dir=$PWD
temp=$(mktemp -d)
export COMPOSE_PROJECT_NAME=supabeacon-install-smoke
cleanup() {
  if [[ -f "$temp/.env" ]]; then (cd "$temp" && docker compose down --volumes >/dev/null 2>&1) || true; fi
  rm -rf "$temp"
}
trap cleanup EXIT
# Never copy real credentials, databases, backups or unrelated source trees.
tar --exclude=.git --exclude=node_modules --exclude=.env --exclude=data --exclude=backups --exclude=dist --exclude=test-results --exclude=playwright-report -cf - . | tar -xf - -C "$temp"
cd "$temp"
printf '18087\nn\n\n3\n1\nEurope/Zurich\nn\n' | ./setup.sh
docker compose exec -T supabeacon node --input-type=module -e 'import Database from "better-sqlite3";const db=new Database(process.env.DATABASE_PATH);const config=JSON.parse(db.prepare("SELECT value FROM settings WHERE key=?").get("monitoring").value);if(config.frequency!==3||config.requests!==1||config.autoEnable!==false)throw new Error("setup values not applied");db.prepare("INSERT INTO settings VALUES(?,?)").run("smoke-marker","true");db.close();'
cp .env .env.before-rerun
./setup.sh
cmp -s .env .env.before-rerun
./scripts/backup.sh
archive=$(find backups -name '*.tar.gz' | sort | head -n 1)
docker compose exec -T supabeacon node --input-type=module -e 'import Database from "better-sqlite3";const db=new Database(process.env.DATABASE_PATH);db.prepare("UPDATE settings SET value=? WHERE key=?").run("false","smoke-marker");db.close();'
printf 'RESTORE\n' | ./scripts/restore.sh "$archive"
docker compose down
docker compose up -d --wait
docker compose exec -T supabeacon node --input-type=module -e 'import Database from "better-sqlite3";const db=new Database(process.env.DATABASE_PATH);if(db.prepare("SELECT value FROM settings WHERE key=?").get("smoke-marker").value!=="true")throw new Error("restore/recreation lost persisted data");if(db.pragma("quick_check",{simple:true})!=="ok")throw new Error("database integrity");db.close();console.log("Installation, idempotence, online backup, restore and container recreation passed.");'
printf 'Disposable installation acceptance test passed for %s\n' "$source_dir"
