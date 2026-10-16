# Supabase Management API OAuth

This is Supabase **Management API OAuth**, not an application project's Supabase Auth server or social sign-in. No Supabase project is required for SupaBeacon itself.

## Registration

Create an OAuth app in your Supabase organization's settings → OAuth Apps. Supply your own name, website and exact callback. Copy the generated client ID and secret into **Settings → Supabase integration**. The secret input is write-only. Configuration and tokens are AES-256-GCM encrypted in local SQLite. Changing client credentials requires disconnecting the existing authorization first.

Register `http://localhost:8080/api/oauth/callback` for localhost development or an SSH tunnel. Register `https://beacon.example.com/api/oauth/callback` for a trusted HTTPS deployment. Use separate clients for separate installations when practical. Client registration/publishing or organization authorization may be subject to Supabase's current requirements.

Official Management OAuth documentation demonstrates localhost HTTP callbacks but does not establish plain HTTP LAN callbacks as a supported deployment pattern. SupaBeacon conservatively rejects non-loopback HTTP callbacks. It never invents a remote callback service. Do not confuse these requirements with the separate Supabase Auth OAuth-server documentation.

## Server accessed from another computer

`localhost` resolves to the browser's computer, not the NUC. Choose one:

- Run `ssh -L 8080:127.0.0.1:8080 user@nuc`, keep loopback binding, open localhost, and register that localhost callback.
- Put the application behind a reverse proxy with a certificate trusted by the browser, use the same HTTPS origin in `APP_URL`, and register its complete callback URL. Restrict direct backend access and set `TRUST_PROXY` only to the actual proxy IP/CIDR if forwarded client IPs are needed.

HTTPS can be served over a private network using a domain and legitimately trusted certificates. A mandatory public hosted service is unnecessary. Visiting the raw LAN address when `APP_URL` is localhost will fail origin checks; use the configured canonical origin.

## Permissions

Required: `projects:read` for discovery and status; `database:read` for the Beta read-only query endpoint. Scope selection occurs in the OAuth app registration; the authorization `scope` query parameter is deprecated and is omitted. When permissions change, reauthorize.

Optional: explicitly enable the Data API strategy in the dashboard and add `secrets:read` in Supabase. This is a broad permission that can access secrets, even though SupaBeacon restricts its own implementation. Explain this to anyone administering the instance. The code lists API key **metadata** with `reveal=false`, chooses `type=publishable`, and reveals only that key by its ID. It never calls legacy key retrieval, never reveals a secret/service-role key, and never caches project API keys. If no existing publishable key is available, the run fails visibly. It does not create a key.

For each Data API project, explicitly choose an existing safe table in the exposed default schema. SupaBeacon performs a bounded HEAD request with `limit=0`; it requests no row bodies and never alters RLS. Check grants, RLS and exposure yourself. RPCs are intentionally excluded because a seemingly read-only RPC could mutate application data.

## Flow

POST connect requires an administrator session, correct Origin and CSRF token. A random state and encrypted PKCE verifier are bound to that session in SQLite for ten minutes. Callback consumes state atomically, compares the session, then exchanges the code server-side with HTTP Basic client authentication and the S256 verifier. Tokens are encrypted together with expiry and provider-reported scopes. Expiring access tokens are refreshed using a single-flight lock; rotated refresh tokens replace old ones. A 401 refreshes once; invalid/revoked refresh credentials require reauthorization. A project-specific 403 reports insufficient access without falsely declaring all authorization revoked.

Disconnect waits for active heartbeats, requests provider-side authorization revocation using the Beta revoke endpoint and removes local tokens. If the provider returns 400/401/403, local credentials are removed but the UI explicitly reports that provider-side revocation was not confirmed; remove authorization in Supabase yourself. Late callbacks cannot restore tokens after disconnect. If a transient provider error prevents revocation, credentials remain locally available for retry; the UI reports failure. Remove authorization directly in Supabase if the provider stays unavailable.

## Sources checked during implementation

- [Build a Supabase OAuth integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)
- [OAuth scopes](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)
- [Management API](https://supabase.com/docs/reference/api/introduction)
- [Read-only query, Beta, database:read](https://supabase.com/docs/reference/api/v1-read-only-query)
- [Project API keys, secrets:read](https://supabase.com/docs/reference/api/v1-get-project-api-keys)
- [Machine-readable API contract](https://api.supabase.com/api/v1-json)
- [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)

These sources document API capabilities. They do not verify this application's live OAuth registration or heartbeat effectiveness. Actual registration and provider response compatibility must be checked with your own valid credentials.
