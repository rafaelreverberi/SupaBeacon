#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
printf '\nWelcome to SupaBeacon!\n\nEnvironment checks:\n'
case "$(uname -s)" in Linux|Darwin) ;; *) printf 'Linux (or macOS for development) is required.\n' >&2; exit 1;; esac
for command in docker openssl awk tar; do command -v "$command" >/dev/null || { printf 'Missing required command: %s\n' "$command" >&2; exit 1; }; done
docker info >/dev/null 2>&1 || { printf 'Docker is not running or is inaccessible.\n' >&2; exit 1; }
docker compose version >/dev/null
printf '[OK] Docker and Docker Compose detected\n[OK] %s %s detected\n' "$(uname -s)" "$(uname -m)"
if [[ -f .env ]]; then
  printf '\nExisting configuration found. Settings, secrets and data will be preserved.\n'
  docker compose up -d --build --wait
  printf '\nSupaBeacon started using the existing .env.\n'
  exit 0
fi
read -r -p 'Dashboard port [8080]: ' port; port=${port:-8080}
[[ "$port" =~ ^[0-9]+$ ]] && (( port>=1024 && port<=65535 )) || { printf 'Choose a port from 1024 to 65535.\n' >&2; exit 1; }
if command -v ss >/dev/null; then
  [[ -z "$(ss -H -ltn "sport = :$port")" ]] || { printf 'Port is already in use.\n' >&2; exit 1; }
elif command -v lsof >/dev/null; then
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null; then printf 'Port is already in use.\n' >&2; exit 1; fi
else printf 'Install iproute2 (ss) or lsof to check port availability.\n' >&2; exit 1; fi
read -r -p 'Allow LAN access? [y/N]: ' lan
bind=127.0.0.1; public_host=localhost
if [[ "$lan" =~ ^[Yy]$ ]]; then
  bind=0.0.0.0
  public_host=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  if [[ -z "$public_host" ]]; then read -r -p 'Server LAN IP or hostname: ' public_host; fi
  [[ "$public_host" =~ ^[a-zA-Z0-9.-]+$ ]] || { printf 'Invalid host.\n' >&2; exit 1; }
  printf 'WARNING: HTTP LAN traffic includes unencrypted passwords and sessions. Use HTTPS for remote access.\nOAuth over plain HTTP LAN is disabled; use HTTPS or a localhost SSH tunnel.\n'
fi
read -r -p 'Canonical access URL (HTTPS reverse proxy if available) [http://'"$public_host:$port"']: ' app_url
app_url=${app_url:-http://$public_host:$port}
[[ "$app_url" =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || { printf 'Use an HTTP(S) origin without a path or trailing slash.\n' >&2; exit 1; }
read -r -p 'Heartbeats per day [2]: ' frequency; frequency=${frequency:-2}
[[ "$frequency" =~ ^[1-6]$ ]] || { printf 'Choose 1–6.\n' >&2; exit 1; }
read -r -p 'Requests per heartbeat [2]: ' requests; requests=${requests:-2}
[[ "$requests" =~ ^[1-3]$ ]] || { printf 'Choose 1–3.\n' >&2; exit 1; }
detected_zone=$(timedatectl show -p Timezone --value 2>/dev/null || true)
detected_zone=${detected_zone:-Europe/Zurich}
read -r -p "Timezone [$detected_zone]: " zone; zone=${zone:-$detected_zone}
[[ "$zone" =~ ^[A-Za-z0-9_+/-]+$ && "$zone" != *..* && -f "/usr/share/zoneinfo/$zone" ]] || { printf 'Unknown IANA timezone.\n' >&2; exit 1; }
read -r -p 'Automatically monitor new projects? [Y/n]: ' auto; auto_enable=true
[[ "$auto" =~ ^[Nn]$ ]] && auto_enable=false
key=$(openssl rand -hex 32); bootstrap=$(openssl rand -hex 32)
cat > .env <<ENV
ENCRYPTION_KEY=$key
SETUP_TOKEN=$bootstrap
APP_URL=$app_url
BIND_ADDRESS=$bind
DASHBOARD_PORT=$port
TIMEZONE=$zone
HEARTBEATS_PER_DAY=$frequency
REQUESTS_PER_HEARTBEAT=$requests
AUTO_ENABLE=$auto_enable
ENV
chmod 600 .env
printf '\n[OK] Configuration and secrets generated\n'
docker compose config --quiet
docker compose up -d --build --wait
printf '\nSupaBeacon is ready!\nDashboard: %s\n\nNext steps:\n1. Find SETUP_TOKEN in .env and create your administrator in the dashboard.\n2. Register your Supabase OAuth application (see docs/oauth-setup.md).\n3. Save its client ID and secret in Settings, then connect Supabase.\n\nBack up .env with the persistent volume; it contains the encryption key.\n' "$app_url"
