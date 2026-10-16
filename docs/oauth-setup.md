# Supabase Management API OAuth

This is Supabase **Management API OAuth**, not an application project's Supabase Auth server or social sign-in. No Supabase project is required for SupaBeacon itself.

## Before you begin

Every self-hosted installation registers its **own OAuth application**. You only do this once per installation, not once per Supabase project. Each installation keeps its own client credentials; no shared SupaBeacon client secret is distributed. After connecting, projects are discovered automatically.

You need:

- A running SupaBeacon instance and its local administrator account.
- A Supabase account with permission to register an OAuth application in your organization. If the OAuth Apps page or creation action is unavailable, ask your organization administrator.
- A browser that can reach the same SupaBeacon origin used for the callback.

Choose your access URL first. For a local installation, use `http://localhost:8080`. For a NUC accessed from another computer, use an SSH tunnel or a trusted HTTPS reverse proxy as described below. Do not enter a raw HTTP LAN address as the OAuth callback: Supabase's registration form requires HTTPS except for localhost, and SupaBeacon rejects non-loopback HTTP callbacks.

## Step 1: Copy your callback from SupaBeacon

1. Open SupaBeacon and sign in as the local administrator.
2. Open **Settings → Supabase integration**.
3. Find **Callback URL** and copy the complete value. This is the source of truth for your installation, including any custom port.

Examples:

| How you access SupaBeacon     | Exact callback example                          |
| ----------------------------- | ----------------------------------------------- |
| Local machine, default port   | `http://localhost:8080/api/oauth/callback`      |
| Local machine, custom port 84 | `http://localhost:84/api/oauth/callback`        |
| HTTPS reverse proxy           | `https://beacon.example.com/api/oauth/callback` |

`beacon.example.com` is an example: replace it with a domain you control. The callback must end in `/api/oauth/callback`; the dashboard homepage alone is not a callback URL. Keep `localhost` and `127.0.0.1` consistent rather than switching between them.

## Step 2: Register an application in Supabase

1. Open the [Supabase Dashboard](https://supabase.com/dashboard).
2. Select the organization in which you want to register your integration.
3. Open the **organization's Settings → OAuth Apps**. This is not the Authentication section inside an individual project.
4. Select **Add application**. The form may be titled **Publish a new OAuth application**.
5. Complete the fields below.

| Field in Supabase               | What to enter                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Application name**            | `SupaBeacon`, or a descriptive name such as `SupaBeacon — Home server`                                                                                                                                                                                                                      |
| **Website URL**                 | Your installation's homepage, for example `http://localhost:8080` for a local test or your actual HTTPS homepage for a deployed instance. If the website field requires a public HTTPS URL, use an actual project/documentation page you control. This field does not replace the callback. |
| **Authorization callback URLs** | Paste the exact **Callback URL** copied in Step 1. Use **Add URL** if the form requires adding the entry.                                                                                                                                                                                   |
| **Upload logo**                 | Optional: download [SupaBeacon_Logo.png](../apps/web/public/branding/SupaBeacon_Logo.png) from this repository or the logo link in SupaBeacon Settings, then select that file. It does not affect authentication.                                                                           |

Set application permissions as follows:

| Permission                                       | Access to select                           | Purpose                                                      |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| **Database**                                     | **Read** / **Read-only** (`database:read`) | Execute the supported Beta read-only heartbeat query         |
| **Projects**                                     | **Read** / **Read-only** (`projects:read`) | Discover authorized projects and check their reported status |
| **All other permissions**, including **Secrets** | **No access**                              | Not needed for the default strategy                          |

Do not select Write or Read & Write. Organizations, Auth, REST, Storage and the analytics permissions are not required by the default strategy. Keep Secrets disabled unless you deliberately opt into the optional Data API strategy later.

Select **Confirm** to create the application. Supabase manages registration/publishing and may impose additional requirements; follow any instructions it shows. Registering this OAuth application does not publish your SupaBeacon source code or deploy a server.

## Step 3: Save the client credentials in SupaBeacon

1. Copy the **Client ID** and **Client Secret** from the newly registered application's details. If the secret is displayed only once, save it securely before leaving that page.
2. Return to **SupaBeacon → Settings → Supabase integration**.
3. Paste them into **OAuth client ID** and **OAuth client secret**.
4. Leave **Enable optional Data API strategy** off for the normal setup.
5. Select **Save OAuth configuration**.

These are the **OAuth application's** credentials. Do not enter a project reference, a database password, a personal access token, an anon key or a service-role key in these fields. Never put the client secret in a GitHub issue, screenshot, repository, Docker image or browser URL.

The secret input is write-only: the saved value is not sent back to the browser. Configuration and tokens are encrypted in local SQLite using the instance's encryption key. Preserve `.env` together with the database in private backups. Changing client credentials later requires disconnecting the current authorization first.

## Step 4: Connect your Supabase account

1. Select **Connect Supabase** in SupaBeacon.
2. Supabase opens its authorization page. Sign in if needed, check the application name and requested permissions, and select the organization offered by the consent flow.
3. Approve access. Supabase redirects back to your installation automatically; keep using the browser/session that started the flow.
4. SupaBeacon immediately synchronizes projects visible to the authorization.

You do **not** need to add a project URL or key for every project. Discovery runs again every two hours by default; **Sync projects** runs it immediately. It only includes projects the granted authorization can access, not every project your account might see elsewhere.

## Step 5: Check the connection

- The Supabase connection indicator should say **Connected**.
- Settings should show a successful project synchronization, or an actionable sync error.
- **Projects** should contain the projects visible to your authorization. An empty list can mean that no projects are accessible through the selected organization/permissions.
- On an active project, open its detail view and select **Run heartbeat / test connection**. Wait for the final execution result. **Running** is not success.
- A successful default heartbeat confirms the expected database response. It does not confirm prevention of automatic inactivity pausing. See [the evidence and alternatives](project-pausing.md).

If connection fails, use the checklist below before creating another OAuth application.

## Common setup mistakes

| Symptom                                        | Check                                                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Redirect/callback URL rejected                 | Match the copied callback exactly: scheme, hostname, port and `/api/oauth/callback`. HTTPS is required except for localhost.            |
| Callback opens the wrong computer              | `localhost` means the browser's computer. For a NUC, use the SSH tunnel or HTTPS instructions below.                                    |
| Origin or CSRF rejected                        | Open the canonical `APP_URL`, not another IP/hostname. Recreate the container after changing `.env`, then refresh/sign in again.        |
| Invalid OAuth state / login required on return | Start again with **Connect Supabase**, in the same browser/session. State expires after ten minutes and is single-use.                  |
| OAuth exchange failed                          | Check that Client ID and Client Secret belong to the same registered OAuth application and that its callback matches.                   |
| Connected, but discovery or heartbeat gets 403 | Check Projects Read and Database Read in the registered application. After changing permissions, reconnect to grant the updated access. |
| Project is paused or unhealthy                 | SupaBeacon deliberately skips it; inspect the provider state in Supabase. It never resumes projects automatically.                      |

See [troubleshooting](troubleshooting.md) for token expiry, safe-table configuration and provider rate limits.

## Changing the dashboard port later

You can change the host port without losing projects, settings or history. Follow [Changing the dashboard port](installation.md#changing-the-dashboard-port-later). In default auto mode, changing DASHBOARD_PORT automatically adjusts the HTTP callback shown in Settings after container recreation; HTTPS addresses stay fixed. APP_URL_MODE=explicit preserves the full configured origin for tunnels and proxies. If the browser-facing origin changes, update the registered OAuth callback to the new value and start a fresh connection flow. If a reverse proxy keeps the same public HTTPS origin, changing only its backend port does not change the OAuth callback.

## Server accessed from another computer

`localhost` resolves to the browser's computer, not the NUC. Choose one:

- Run `ssh -L 8080:127.0.0.1:8080 user@nuc`, keep loopback binding, open localhost, and register that localhost callback.
- Put the application behind a reverse proxy with a certificate trusted by the browser, use the same HTTPS origin in `APP_URL`, and register its complete callback URL. Restrict direct backend access and set `TRUST_PROXY` only to the actual proxy IP/CIDR if forwarded client IPs are needed.

HTTPS can be served over a private network using a domain and legitimately trusted certificates. A mandatory public hosted service is unnecessary. Visiting the raw LAN address when `APP_URL` is localhost will fail origin checks; use the configured canonical origin.

## Permissions

Required: `projects:read` for discovery and status; `database:read` for the Beta read-only query endpoint. Scope selection occurs in the OAuth app registration; the authorization `scope` query parameter is deprecated and is omitted. When permissions change, reauthorize.

Optional: explicitly enable the Data API strategy in the dashboard and add `secrets:read` in Supabase. This is a broad permission that can access secrets, even though SupaBeacon restricts its own implementation. Explain this to anyone administering the instance. The code lists API key **metadata** with `reveal=false`, chooses `type=publishable`, and reveals only that key by its ID. It never calls legacy key retrieval, never reveals a secret/service-role key, and never caches project API keys. If no existing publishable key is available, the run fails visibly. It does not create a key.

For each Data API project, explicitly choose an existing safe table in the exposed default schema. SupaBeacon performs a bounded HEAD request with `limit=1`; it requests no row bodies and never alters RLS. Check grants, RLS and exposure yourself. RPCs are intentionally excluded because a seemingly read-only RPC could mutate application data.

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
