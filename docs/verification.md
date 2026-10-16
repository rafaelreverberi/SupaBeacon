# Verification record

Verified locally on 16 October 2026. No real Supabase OAuth credentials were supplied. Provider API operations in automated tests use controlled injected responses; production never uses the test transport or seeds fixtures.

## Passed

- `npm run typecheck`: strict TypeScript checks across server, frontend and tests.
- `npm run lint`: ESLint, including React hooks rules.
- `npm test`: **24** unit/integration tests. Covers local-day random/fixed windows, stable random distribution, Europe/Zurich DST on 29 March and 25 October 2026, midnight rollover, settings validation, budgets, retries/jitter/Retry-After, authenticated encryption/tamper rejection, first administrator and sessions, Origin/CSRF checks, OAuth PKCE and one-use session-bound callback state, encrypted storage, discovery/upserts/status and organization transitions, visibility removal, disabled new-project defaults, successful/invalid database responses, paused projects, concurrent runs, 429/403, single-flight refresh and revoked authorization, selective publishable-key retrieval, persistent unique jobs, old-job skipping, interrupted-run recovery, re-planning cancelled future jobs, history/log filters, retention while paused/disconnected, transient retry recovery, unconfirmed provider revocation and cancellation of late OAuth callbacks after disconnect, and durable partial database success while another request remains in flight.
- `npm run build`: server JavaScript and optimized frontend build. Charts are loaded in a separate chunk.
- `npm run test:e2e`: Chromium browser journey covering protected first-run setup, administrator login/logout, settings persistence after reload, dark/light theme, monitoring toggles, manual heartbeat and final database-success result, native modal/keyboard Escape, log search/expansion, desktop navigation, mobile navigation at 390×844, absence of horizontal page overflow, visible login errors and no uncaught browser errors. Desktop/mobile screenshots were inspected; README screenshots show clearly identified test fixtures.
- `docker compose config --quiet`.
- Native Linux ARM64 Docker image build and non-root container start. Healthcheck is healthy; `/api/health` returns 200. SQLite reports WAL and integrity `ok`.
- Linux AMD64 image built using Docker Buildx on ARM64; launched under emulation and returned healthy HTTP 200. This verifies an emulated container, not a physical Intel NUC or real Linux server reboot.
- `scripts/smoke-install.sh`: disposable first-run interactive `setup.sh`, prompted configuration persisted correctly, second setup preserved `.env`, online SQLite backup, confirmation-gated restore, removal/recreation of the container with persisted marker intact, and database integrity. The disposable volume/network were cleaned up.
- Real local instance backup and restore scripts also completed successfully while the production entrypoint served an empty, unconnected workspace. The local administrator remains unconfigured for the owner.
- Shell syntax checked with `bash -n setup.sh scripts/*.sh`.
- Dependency audit reported no known vulnerabilities at implementation time; this is a point-in-time package advisory check, not a penetration test.

## Reproduce

```bash
npm ci
npm run init
npm run check
npm run format:check
npx playwright install chromium
npm run test:e2e
./scripts/smoke-install.sh
```

The smoke install test requires Docker, available port 18087, Bash, OpenSSL and `ss` or `lsof`. It uses the isolated Compose project `supabeacon-install-smoke` and removes only that project's disposable volume. Do not run two copies of this smoke test concurrently.

For AMD64 verification from ARM64:

```bash
docker buildx build --platform linux/amd64 --load -t supabeacon:amd64-test .
```

Before publication, stage intended source files and run `npm run security:check`. It rejects tracked runtime data/configuration and exact generated local secret values without printing them. Review the diff manually as well. The local `.env`, database, test output and backup archives must remain ignored.

## Requires valid external credentials or hardware

Actual Supabase OAuth application registration, consent, authorization-code exchange, refresh rotation/revocation against the live provider, permissions across real organizations, real Management API Beta response compatibility, actual safe-table PostgREST/RLS requests and real provider rate-limit behavior are implemented but **not live verified**. No table, schema, key or Supabase project was created or modified during development.

No physical NUC/Raspberry Pi, remote LAN browser, trusted HTTPS reverse proxy/certificate, sudden power failure or host reboot was tested. Container recreation, SQLite persistence and simulated interrupted-run recovery were tested instead.

Neither strategy's effectiveness against Supabase's automatic inactivity pausing has been verified. There is no guaranteed keep-active state in the product. The read-only endpoint is Beta and may change. Head-only zero-row Data API requests establish a database-facing operation, not meaningful user activity under an undocumented policy threshold.
