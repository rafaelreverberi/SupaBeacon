# Troubleshooting

**Origin rejected / CSRF rejected:** Open the exact configured APP_URL. A LAN address and localhost are different origins. After changing `.env`, recreate the container. Refresh your session after logout/password changes. Never disable CSRF to solve an origin mismatch.

**First-run token rejected:** Read SETUP_TOKEN from the instance's private `.env`. It is not a Supabase credential. Setup becomes unavailable once an administrator exists. Do not reset persistent data just to retry registration.

**Can't connect from another computer:** Default port binding is 127.0.0.1. Use an SSH localhost tunnel, or explicitly configure LAN binding and trusted HTTPS. Check host firewall, Docker mappings and the chosen port. Opening raw HTTP LAN does not enable an OAuth callback there.

**OAuth invalid callback:** Use Supabase organization's Management API OAuth Apps, not project Authentication settings. Register the full exact callback shown in this app. Verify URL scheme, hostname, port and path; ensure browser, proxy and APP_URL agree. Plain HTTP LAN callbacks are rejected locally. Loopback callbacks require the browser and app to share that loopback route, normally via SSH forwarding for a NUC.

**Reconnect required:** Refresh authorization was revoked/expired or upstream access still fails after a single refresh. Reconnect in Settings. Updating OAuth app scopes requires reauthorization. A project-specific 403 may instead mean missing permissions for only that project.

**No projects / access unavailable:** Discovery includes only provider-authorized visibility. Check organization selection and projects:read. Sync manually and inspect Settings → integration. A successful list marks missing projects unavailable without claiming deletion; a failed/partial malformed list does not clear the cache.

**Project paused/unhealthy:** SupaBeacon only queries ACTIVE_HEALTHY projects and never silently resumes one. Inspect the project in Supabase. Provider status is distinct from local monitoring enablement.

**Database result unverified:** The Beta read-only query did not return the expected single numeric heartbeat row. HTTP success alone is insufficient. Review current provider API compatibility and use controlled fixtures before changing response validation. Do not replace validation with a blanket success check.

**Data API no publishable key:** Explicitly enable the strategy, grant secrets:read in the registered OAuth app and reauthorize. Only existing keys typed publishable are supported; legacy anon/service-role or secret keys are not substituted. Select a safe existing table and verify its Data API exposure/RLS. No rows are fetched, and the application never creates keys or tables.

**429 / Retry-After:** Cooldowns are persisted. Wait for the next legitimate run; do not increase traffic. Long Retry-After values finish the current execution as failed rather than occupying a worker indefinitely. Retries add HTTP overhead beyond the default estimate.

**Missed runs after downtime:** Jobs older than fifteen minutes are skipped, not replayed. Interrupted in-flight jobs are not repeated. This intentionally avoids restart bursts and duplicate remote requests.

**SQLite locked:** Ensure there is only one application process/container per volume. Avoid network filesystems with unreliable file locking. WAL and a busy timeout handle brief local contention. Check disk space and volume permissions. Keep a consistent backup before maintenance.

**Unhealthy container:** Use `docker compose logs --tail=100` and `docker compose ps`. Check APP_URL, ENCRYPTION_KEY format, volume permissions and Docker memory availability. A mismatched encryption key requires restoring the original key or re-registering OAuth; it cannot decrypt old tokens.

**Backup/restore failure:** The running source instance and Docker are required for scripted online backups. Preserve .env and the named volume before manual repair. Archives must contain exactly regular .env, database.sqlite and MANIFEST files. A restore safety backup requires the existing instance to be running. Do not paste backups or environment files into bug reports.

**Stopping:** `docker compose stop` or `down` preserves the named volume. The process stops accepting requests, stops new jobs, cancels retry sleeps, waits for bounded in-flight requests and closes SQLite. Stop grace is 90 seconds. Never delete the volume to fix a routine startup problem.
