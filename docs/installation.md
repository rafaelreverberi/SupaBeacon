# Installation and operation

Run `./setup.sh` from this directory. Linux is the deployment target; macOS is supported for development. The script checks Docker availability, Compose, host port availability, configuration ranges, timezone and host input. New `.env` files use mode 0600. Re-running setup preserves existing secrets and SQLite settings, rebuilds and starts the current source. It never deletes the data volume.

The application supports native AMD64 and ARM64 builds. The supplied Dockerfile builds native SQLite/Argon2 dependencies within the target architecture; cross-compilation needs Docker Buildx/QEMU or a native target builder. Container runtime uses Node.js 24 LTS, an unprivileged node user, dropped capabilities, no-new-privileges, read-only root filesystem, a small temporary filesystem and one persistent data volume. No Docker socket or privileged mode is used.

The selected external port maps to container 8080. Internal healthcheck always uses 127.0.0.1:8080. Wait for health with `docker compose up -d --build --wait`; inspect with `docker compose ps` and `docker compose logs -f --tail=100`.

## Canonical origin and reverse proxy

`APP_URL` is the exact origin used by browsers and OAuth. Do not put a path, credentials or query in it. Set host binding explicitly for LAN or proxy access. The default is loopback; forward localhost over SSH for remote administration without publishing the port. Plain HTTP LAN sends credentials without transport encryption.

Example Caddyfile for an administrator-managed reverse proxy on the same host:

```caddy
beacon.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Use `APP_URL=https://beacon.example.com`, keep the port bound to loopback, arrange DNS/certificates normally and register the exact callback. If relying on forwarded client IPs for rate limiting, set `TRUST_PROXY` to the specific proxy IP/CIDR as seen by the container. A proxy container should reach an internal network endpoint instead; do not trust all proxies. The static canonical URL controls secure cookies independently of untrusted forwarded headers. The application uses HTTP internally behind TLS termination.

Enable Docker's service on your Linux host according to your distribution. Restart policy is `unless-stopped`; deliberately stopped services remain stopped after a reboot.

## Backups

`./scripts/backup.sh` invokes the running container's SQLite online backup API, copies a consistent snapshot and `.env` to a private timestamped archive under `backups/`. WAL data is included. This directory is ignored by Git. Archive contents include encrypted OAuth tokens and the plaintext encryption key: filesystem permissions protect local access, not transport. Use your own secure off-site storage and encryption.

`./scripts/restore.sh PATH` checks archive members, prompts for `RESTORE`, backs up the existing running instance, stops it, restores the backed-up `.env`, checks SQLite integrity in a one-off container, restores the database, and starts the service. Keep a copy of the current `.env` and archive externally before recovery. Do not restore an untrusted archive. Missing or corrupted source configuration may require manual recovery of `.env` before the script can run. Restoration preserves the old administrator and sessions; revoke unwanted sessions after recovery.

## Updates

Review/check out the desired trusted revision, then run `./scripts/update.sh`. It backs up and rebuilds the local source. No git pulls or remote publications happen automatically. Check health after an update. Existing data is persistent; migrations execute transactionally. Restore the matching data/key backup and previous source if a later migration requires rollback.

## Uninstall

Run `docker compose down` to remove the application's container/network while preserving its named volume. Remove the local source directory only after saving needed backups and `.env`. Data deletion is a separate, explicit operator action: inspect `docker volume ls`, identify the correct volume, and remove it only if you intend permanent deletion. No uninstall script deletes volumes. Never use `docker compose down -v` unless you explicitly want data destroyed.
