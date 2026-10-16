#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
[[ $# -eq 1 && -f "$1" ]] || { printf 'Usage: scripts/restore.sh backups/BACKUP.tar.gz\n' >&2; exit 1; }
archive=$1
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
# Extract only named regular files; reject links and unexpected archive members.
while IFS= read -r entry; do [[ "$entry" == .env || "$entry" == database.sqlite || "$entry" == MANIFEST ]] || { printf 'Unexpected backup entry.\n' >&2; exit 1; }; done < <(tar -tzf "$archive")
if tar -tvzf "$archive" | awk 'substr($1,1,1)!="-" {bad=1} END {exit !bad}'; then printf 'Backup links and directories are not allowed.\n' >&2; exit 1; fi
tar -xzf "$archive" -C "$temp" .env database.sqlite MANIFEST
[[ -s "$temp/.env" && -s "$temp/database.sqlite" ]] || exit 1
printf 'Restore replaces this instance, including its administrator, credentials, and history.\n'
read -r -p 'Type RESTORE to continue: ' confirmation
[[ "$confirmation" == RESTORE ]] || exit 1
if [[ -f .env ]]; then
  ./scripts/backup.sh
  docker compose stop
fi
cp "$temp/.env" .env
chmod 600 .env
cat "$temp/database.sqlite" | docker compose run --rm --no-deps -T supabeacon node --input-type=module -e 'import Database from "better-sqlite3";import {readFileSync,writeFileSync,chmodSync,rmSync,renameSync} from "node:fs";const candidate=process.env.DATABASE_PATH+".restore";writeFileSync(candidate,readFileSync(0),{mode:0o600});const source=new Database(candidate);if(source.pragma("quick_check",{simple:true})!=="ok")throw new Error("Invalid backup database");source.close();for(const suffix of ["-wal","-shm"])rmSync(process.env.DATABASE_PATH+suffix,{force:true});renameSync(candidate,process.env.DATABASE_PATH);chmodSync(process.env.DATABASE_PATH,0o600);'
docker compose up -d --wait
printf 'Restore complete. Sign in using the backed-up administrator account.\n'
