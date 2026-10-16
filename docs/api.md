# Internal REST API

JSON responses use route-specific typed objects; errors consistently use `{ "error": { "code": "MACHINE_CODE", "message": "safe message", "fields": [] } }`. Validation fields appear only for input errors. Error codes never contain provider response bodies or credentials.

All `/api` routes require an administrator cookie except health, auth status, first-run setup and login. OAuth callback also requires the originating administrator session. Every mutation requires the exact configured `Origin`; authenticated mutations additionally require the session's `X-CSRF-Token`. Obtain the CSRF token from authenticated `GET /api/auth/status`. Cookies are HttpOnly, SameSite=Lax and Secure when APP_URL is HTTPS. APIs are same-origin; there is no permissive CORS.

| Method | Path                        | Contract                                                                      |
| ------ | --------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/health`               | Public minimal database/process health                                        |
| GET    | `/api/auth/status`          | Auth/setup state; authenticated username/CSRF                                 |
| POST   | `/api/auth/setup`           | `{username,password,setupToken}`; singleton admin, ≥12 character password     |
| POST   | `/api/auth/login`           | `{username,password}`; cookie and CSRF                                        |
| POST   | `/api/auth/logout`          | Revoke current session                                                        |
| POST   | `/api/auth/password`        | `{current,password}`; revoke other sessions                                   |
| GET    | `/api/auth/sessions`        | `{items}`; current flag, timestamps, opaque session hashes                    |
| DELETE | `/api/auth/sessions/:id`    | Revoke one session                                                            |
| GET    | `/api/dashboard?days=7`     | Project counts, today totals, chart, scheduler/connection/uptime; days 7–30   |
| GET    | `/api/projects`             | `{items}` including unavailable cached projects                               |
| POST   | `/api/projects/sync`        | Fetch provider list, upsert and reconcile visibility                          |
| GET    | `/api/projects/:id`         | Project and effective settings                                                |
| PATCH  | `/api/projects/:id`         | Partial `{enabled,overrides:{frequency?,requests?}                            | null,strategy,safeTable}` |
| POST   | `/api/projects/:id/run`     | HTTP 202 `{id,state:"running"}`; poll execution ID for final outcome          |
| GET    | `/api/projects/:id/history` | Paginated execution history                                                   |
| GET    | `/api/executions`           | `{items,total,page}`                                                          |
| GET    | `/api/executions/:id`       | Execution and per-attempt `details`                                           |
| GET    | `/api/logs`                 | `{items,total,page}`; sanitized events only                                   |
| GET    | `/api/logs/export`          | JSON attachment, up to 10,000 matching events                                 |
| GET    | `/api/settings`             | Monitoring/preferences plus readonly system info                              |
| PATCH  | `/api/settings`             | Complete shared Settings object (omit readonly system fields)                 |
| POST   | `/api/scheduler/pause`      | Persist global monitoring=false                                               |
| POST   | `/api/scheduler/resume`     | Persist global monitoring=true                                                |
| GET    | `/api/oauth/status`         | Connection, callback, setup status, expected/reported scopes, last sync/error |
| PUT    | `/api/oauth/config`         | `{clientId,clientSecret,dataEnabled}`; credentials are write-only             |
| POST   | `/api/oauth/connect`        | `{url}` authorization URL; random session-bound PKCE/state                    |
| GET    | `/api/oauth/callback`       | One-use `code,state` callback; redirects locally                              |
| POST   | `/api/oauth/disconnect`     | Revoke authorization and remove local tokens; `{ok,providerRevoked}`          |
| GET    | `/api/diagnostics`          | Sanitized downloadable system report                                          |

History/log filters: `page` (1-based, 30 rows/page), `project`, `from`, `to` (epoch milliseconds). Logs also support `level` (`debug|info|warning|error`) and `search` across event name/details. Query values are validated and bound in prepared statements.

Useful errors: `AUTH_REQUIRED` (401), `CSRF_REJECTED`/`ORIGIN_REJECTED` (403), `VALIDATION_ERROR` (400), `INVALID_OAUTH_STATE` (400), `OAUTH_REAUTHORIZE`, `PROJECT_PERMISSION_DENIED`, `PROJECT_NOT_ACTIVE` (409), `PROJECT_ALREADY_RUNNING` (409), `CONCURRENCY_LIMIT` (409), `SCHEDULER_PAUSED` (409), `RATE_LIMITED` (429), `DATABASE_RESULT_UNVERIFIED`, `DATA_QUERY_FAILED`, `SUPABASE_REQUEST_FAILED`, `UPSTREAM_UNREACHABLE` and `INTERNAL_ERROR`.

`database_ok=1` means at least one database operation succeeded during the execution. `state=success` additionally requires every configured heartbeat request to succeed. `requests` counts database attempts; metadata, status, OAuth and discovery HTTP requests are not included in that field. `execution_requests` includes status-check and heartbeat failures for diagnostic accuracy. History never represents queued or running work as already successful.
