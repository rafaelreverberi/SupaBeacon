# Installation and operation

Run `./setup.sh` from this directory. Linux is the deployment target; macOS is supported for development. The script checks Docker availability, Compose, host port availability, configuration ranges, timezone and host input. New `.env` files use mode 0600. Re-running setup preserves existing secrets and SQLite settings, rebuilds and starts the current source. It never deletes the data volume.

The application supports native AMD64 and ARM64 builds. The supplied Dockerfile builds native SQLite/Argon2 dependencies within the target architecture; cross-compilation needs Docker Buildx/QEMU or a native target builder. Container runtime uses Node.js 24 LTS, an unprivileged node user, dropped capabilities, no-new-privileges, read-only root filesystem, a small temporary filesystem and one persistent data volume. No Docker socket or privileged mode is used.

For Compose, change **DASHBOARD_PORT**, not PORT: PORT is the internal Node listener. For a bare Node process outside Docker, set PORT to its actual listening port as well. The selected external port maps to container 8080. Internal healthcheck always uses 127.0.0.1:8080. Wait for health with `docker compose up -d --build --wait`; inspect with `docker compose ps` and `docker compose logs -f --tail=100`.

## Canonical origin and reverse proxy

`APP_URL` supplies the browser hostname and scheme. With `APP_URL_MODE=auto` (the default), direct HTTP origins use the current `DASHBOARD_PORT`; HTTPS origins remain unchanged. With `APP_URL_MODE=explicit`, the complete APP_URL is preserved, including its port. Do not put a path, credentials or query in it. Set host binding explicitly for LAN or proxy access. The default is loopback; forward localhost over SSH for remote administration without publishing the port. Plain HTTP LAN sends credentials without transport encryption.

Example Caddyfile for an administrator-managed reverse proxy on the same host:

```caddy
beacon.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Use `APP_URL=https://beacon.example.com`, keep the port bound to loopback, arrange DNS/certificates normally and register the exact callback. If relying on forwarded client IPs for rate limiting, set `TRUST_PROXY` to the specific proxy IP/CIDR as seen by the container. A proxy container should reach an internal network endpoint instead; do not trust all proxies. The static canonical URL controls secure cookies independently of untrusted forwarded headers. The application uses HTTP internally behind TLS termination.

Enable Docker's service on your Linux host according to your distribution. Restart policy is `unless-stopped`; deliberately stopped services remain stopped after a reboot.

## Changing the dashboard port later

The host port can be changed after installation. For example, to access a local installation at `http://localhost:84`:

1. Check that port 84 is free on the server.
2. Edit the existing `.env` without replacing its encryption key or setup token:

   ```dotenv
   DASHBOARD_PORT=84
   # APP_URL can remain http://localhost:8080: auto mode uses the new port.
   APP_URL_MODE=auto
   ```

3. In auto mode, Settings → General and the OAuth callback automatically use the effective HTTP origin `http://localhost:84` after recreation. SupaBeacon does not edit `.env` or your registered Supabase application. Keep the existing `BIND_ADDRESS` unless you deliberately want to change network exposure. The internal container port stays **8080**; do not change Compose's `PORT` or the healthcheck to 84.
4. Apply the configuration:

   ```bash
   docker compose up -d --force-recreate --wait
   ```

5. Open the new URL and sign in if requested. In **Settings → Supabase integration**, copy the updated callback and register it in your Supabase OAuth application's callback list: `http://localhost:84/api/oauth/callback` in this example. Start a fresh connection flow if reconnecting; a flow started with the old callback cannot finish with a different callback.

The named data volume, project configuration and monitoring history are preserved. Do not delete the volume or rerun secret generation to change a port. Re-running `setup.sh` preserves an existing `.env`; edit that file for later port changes.

Port 84 is a low host port. Normal rootful Docker can publish it while the application inside the container remains non-root. Rootless Docker or host policy may restrict ports below 1024; choose a higher port or configure the host appropriately. The interactive first-install wizard currently accepts ports **1024–65535**; low-port mappings such as 84 can be configured manually afterward.

If an HTTPS reverse proxy remains at `https://beacon.example.com`, change `DASHBOARD_PORT` and the proxy's upstream target, but keep `APP_URL=https://beacon.example.com`. Its registered callback remains `https://beacon.example.com/api/oauth/callback`. With an SSH tunnel or HTTP reverse proxy whose browser-facing port differs from Docker’s host port, set `APP_URL_MODE=explicit` and `APP_URL` to the **browser’s local forwarded address**. For example: `DASHBOARD_PORT=84`, `APP_URL=http://localhost:8080`, `APP_URL_MODE=explicit` and `ssh -L 8080:127.0.0.1:84 user@nuc`. HTTPS addresses already remain fixed in auto mode.

## Backups

`./scripts/backup.sh` invokes the running container's SQLite online backup API, copies a consistent snapshot and `.env` to a private timestamped archive under `backups/`. WAL data is included. This directory is ignored by Git. Archive contents include encrypted OAuth tokens and the plaintext encryption key: filesystem permissions protect local access, not transport. Use your own secure off-site storage and encryption.

`./scripts/restore.sh PATH` checks archive members, prompts for `RESTORE`, backs up the existing running instance, stops it, restores the backed-up `.env`, checks SQLite integrity in a one-off container, restores the database, and starts the service. Keep a copy of the current `.env` and archive externally before recovery. Do not restore an untrusted archive. Missing or corrupted source configuration may require manual recovery of `.env` before the script can run. Restoration preserves the old administrator and sessions; revoke unwanted sessions after recovery.

## Updates

Review/check out the desired trusted revision, then run `./scripts/update.sh`. It backs up and rebuilds the local source. No git pulls or remote publications happen automatically. Check health after an update. Existing data is persistent; migrations execute transactionally. Restore the matching data/key backup and previous source if a later migration requires rollback.

## Uninstall

Run `docker compose down` to remove the application's container/network while preserving its named volume. Remove the local source directory only after saving needed backups and `.env`. Data deletion is a separate, explicit operator action: inspect `docker volume ls`, identify the correct volume, and remove it only if you intend permanent deletion. No uninstall script deletes volumes. Never use `docker compose down -v` unless you explicitly want data destroyed.
