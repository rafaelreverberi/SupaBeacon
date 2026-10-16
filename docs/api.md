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

## Optional activity contract

`POST /api/projects/:id/activity-schema` returns `{schema:"public",tables:[{name,columns:[{name,type}]}]}` for a present, active project. It requires the administrator session and CSRF token, uses `database:read`, and needs no test-account credentials or Secrets Read. A fixed metadata-only SELECT lists supported public base tables, capped at 2,000 columns and a 1 MiB response. No user SQL is accepted; no row contents are read. It runs only on explicit request, does not change monitoring configuration or history, and is rate-limited to six calls per minute per client IP. Empty metadata returns an empty table list; provider denial, invalid metadata or an oversized schema produce errors. Listed names do not establish Data API/RLS access.

Project responses include `activity: {enabled,mode,table,column,reads,credentialsConfigured,sessionReviewRequired,signInError}`. The default is disabled. PATCH accepts a complete `activity` object with `enabled`, `mode` (`public-read|test-sign-in`), nullable identifier-only `table`/`column`, and `reads` (1–3). Optional `testAccount: {email,password,dedicated:true}` replaces encrypted write-only credentials; omission preserves them and null removes them. `acknowledgeSessionReview:true` explicitly acknowledges operator review of an uncertain remote session; it does not revoke a session. No email/password/ciphertext/JWT is returned.

Enabled profiles require the existing explicit Data API capability. Test sign-in additionally requires saved/provided test credentials and no unresolved session review. Reconfiguring enabled activity during an active execution returns PROJECT_ALREADY_RUNNING; disabling is allowed. Existing projects and newly discovered projects receive no additional traffic until their own profile is enabled.

Executions add `activity_state`, `activity_requests`, `activity_successes`, `activity_reads` and `activity_error`. Primary `requests`/`successes` remain heartbeat-only. Optional request details include `kind` (`activity_read|auth_sign_in|auth_sign_out`, alongside the existing `heartbeat`) and nullable `row_count`; no returned values. `activity_requests` counts initiated optional HTTP attempts, including Auth; dashboard database totals additionally count recorded optional read attempts. See [optional activity](optional-project-activity.md) for budgets and cleanup semantics.

A sanitized `signInError` blocks further Auth attempts after rejected credentials or detected MFA until `testAccount` is explicitly replaced/removed. This does not imply a session exists. `sessionReviewRequired` instead denotes an uncertain session and needs explicit review. Clearing session review while a project is running is rejected.

### Multiple activities

Project responses now include `activities: [{id,name,...activityFields}]`. `POST /api/projects/:id/activities` with `{name,mode?}` creates a disabled entry (201), capped at eight per project. `PATCH /api/projects/:id/activities/:activityId` accepts the full activity configuration above plus optional `name`; credentials are write-only and scoped to that entry. `DELETE` on the same route removes its configuration/credentials, retaining history. Administrator session and CSRF are required for all mutations.

Creation and deletion are blocked while a project is running; enabled reconfiguration and review acknowledgement retain their existing running guards. Disabling remains allowed. Unresolved session review blocks deletion. Unknown entries or entries belonging to another project return 404. The legacy project PATCH `activity` field and project response `activity` refer only to the migrated `default` entry and remain for compatibility; the dashboard uses `activities` and the new routes. Request details now include nullable `activity_id` and `activity_name` snapshots; pre-upgrade records retain null attribution. Counters summarize all enabled entries and any failed entry makes the overall optional execution failed.
