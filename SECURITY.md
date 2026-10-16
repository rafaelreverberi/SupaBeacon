# Security policy and threat model

SupaBeacon controls OAuth credentials with access to authorized Supabase projects. Treat the host, local administrator and backups as privileged infrastructure. This is a single-administrator, single-process self-hosted application, not a multitenant service. Do not expose it directly to the public internet without trusted TLS and appropriate host/network controls.

## Assets and boundaries

Assets: OAuth client secret, access/refresh tokens, administrator password hash, session tokens, encryption key, project metadata and operation history. Boundaries: browser ↔ local API; API ↔ SQLite/filesystem; API ↔ Supabase HTTPS; administrator ↔ Docker host; backup archive ↔ external storage. The server administrator and Docker daemon are trusted. A compromised host can obtain both the database and encryption key; encryption at rest does not defend against root or code execution inside the application.

## Implemented controls

- First-run account creation requires a separately generated 256-bit bootstrap secret. A singleton database constraint prevents creating a second administrator. Argon2id uses 64 MiB, three iterations and one lane; passwords are never logged or retained.
- Random 256-bit session cookies are HttpOnly, SameSite=Lax, expire after seven days and are stored only as SHA-256 hashes. HTTPS origins enable Secure cookies. Session listing, revocation, logout and password rotation are supported; changing password revokes other sessions.
- Login/bootstrap have per-client-IP limits. Configure explicit trusted proxy addresses if required; broad proxy trust permits forged client IPs. Low request body limits, Zod validation, security headers and same-origin mutation checks reduce attack surface.
- Authenticated writes require a session CSRF token as well as exact Origin. No cross-origin CORS is enabled. XSS remains a threat to authenticated administrator actions; React escapes content, and CSP disallows external scripts, frames and object content.
- OAuth state is random, hashed, one-use, expiring and bound to the administrator session. PKCE S256, exact configured callback origins and server-side Basic client authentication are used. No client secret or provider tokens are returned to frontend JavaScript.
- AES-256-GCM encrypts the OAuth registration, tokens and transient PKCE verifier, with fresh random nonces and authenticated tags. The 32-byte encryption key lives outside the database in the ignored private `.env`. Losing it prevents decrypting OAuth state. There is no embedded production credential.
- Upstream URLs are fixed HTTPS provider hosts. Project references and table identifiers are constrained. Redirect following is forbidden, requests have deadlines, and there is no arbitrary URL/SQL/RPC input. Provider response bodies are not logged; only fixed error codes and metadata are persisted. Secrets and session cookies are redacted from structured HTTP logs; automatic request logging is disabled to avoid callback codes in URLs.
- Provider permissions default to projects:read/database:read. Optional secrets:read requires explicit configuration and is broad at the provider level; the implementation lists key metadata without reveal and retrieves only a typed publishable key by ID. Privileged keys, database passwords and legacy service-role endpoints are never used. RLS/schema/application data are never changed.
- Prepared statements, foreign keys, transactional migrations, unique job IDs, partial execution uniqueness and SQLite WAL/full synchronization protect persistence. One process must own each volume. Crashed remote requests are never blindly replayed.
- Runtime is non-root with dropped capabilities, no Docker socket, no-new-privileges, a read-only root filesystem and resource limits. SQLite data is in a dedicated volume, with database file mode 0600.

## Residual risks and deployment responsibilities

HTTP LAN administration is unencrypted: other network actors may observe credentials/sessions. Use HTTPS with a trusted certificate or an authenticated localhost SSH tunnel. Non-loopback HTTP OAuth callbacks are disabled. Do not assume localhost refers to the remote NUC.

The host encryption key and database must be backed up together. Backup archives contain both and therefore are **sensitive plaintext-equivalent material**, even though the OAuth records themselves are encrypted. Local mode 0600 is not encryption; secure off-site storage yourself. Restore only trusted backups. Restoring also restores administrator sessions; revoke stale ones after recovery.

Supabase's broad optional secret scope cannot be narrowed by this app's promises if the host/application itself is compromised. Leave it disabled unless you need the Data API strategy. The app does not prove whether a table is safe to expose; administrators must choose an existing safe table whose grants/RLS already match intended use. Database success does not establish prevention of inactivity pausing.

Application or dependency vulnerabilities, endpoint changes, resource exhaustion, remote API quota consumption and administrator account compromise remain possible. Keep source/dependencies and host software current, inspect changes before updating, and monitor actual Supabase account warnings. No project-unpause endpoint is implemented.

## Reporting

Do not publish tokens, passwords, `.env`, database files or backups in an issue. Until this repository has a designated private security contact, report vulnerabilities privately to the instance/repository maintainer through an established private channel. Open only sanitized general issues. This repository has no automatic publication workflow or telemetry.
