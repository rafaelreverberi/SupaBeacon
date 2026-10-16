# Database success and Supabase project pausing

## What the official policy establishes

Supabase's [Project Pausing guide](https://supabase.com/docs/guides/platform/free-project-pausing) describes a seven-day activity window for Free Plan databases. It says a few daily user database requests are typically sufficient and identifies project/application API activity as a way to generate activity. It does not publish an exact threshold or explicitly classify SupaBeacon's two strategies. Paid plans are excluded from automatic inactivity pausing.

## What SupaBeacon actually verifies

| Signal                                     | Meaning                                                                                           | Does it prove prevention of pausing?                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| HTTP 2xx                                   | An endpoint accepted the request                                                                  | No                                                                       |
| Management heartbeat success               | The fixed `SELECT 1 AS heartbeat;` returned exactly the expected numeric row                      | No                                                                       |
| Data API heartbeat success                 | An authorized, bounded PostgREST table HEAD request succeeded with the expected response metadata | No                                                                       |
| ACTIVE_HEALTHY                             | Supabase reported that project status at the time of the check                                    | No                                                                       |
| A project remains active for several weeks | An observation under that project's workload                                                      | No causal guarantee; other application/dashboard activity may contribute |

The default [read-only Management API endpoint](https://supabase.com/docs/reference/api/v1-read-only-query) executes as `supabase_read_only_user` and is Beta. A real query response is verified, but whether that particular role/query contributes to the pausing decision is undocumented. Do not interpret absence of a guarantee as proof that it is ineffective, either.

## Alternatives if pausing warnings continue

1. Check whether configured runs actually complete, the server stays online, OAuth remains valid and the project is not paused/unhealthy. Inspect execution history and Supabase's warning emails.
2. Prefer useful reads from a connected application when possible. This naturally exercises its real database access path.
3. Optionally use SupaBeacon's existing **Data API** strategy on an explicitly selected existing safe table. It makes a HEAD request with `limit=1`, allowing at most one row in the query result while suppressing the response body. Existing grants/RLS still apply. This exercises the application-facing database API, but remains unverified against the pausing policy. PostgREST [documents HEAD as a read without a response body](https://docs.postgrest.org/en/stable/references/api/tables_views.html#get-and-head), with aggregation optimized away; a specific amount of physical table I/O is not promised. A zero-row result can still occur under RLS or on an empty table.
4. If project availability must be assured against inactivity pausing, use a paid plan according to Supabase's policy. SupaBeacon cannot offer the same assurance through traffic alone.

Data API access is opt-in: enable it in SupaBeacon, add Secrets Read in the registered OAuth application, reauthorize, then choose a safe existing table in each project's configuration. The broad provider permission deserves consideration; SupaBeacon only reveals an existing key typed publishable and never uses privileged keys. It does not create tables, alter RLS or switch existing projects automatically. See [OAuth setup](oauth-setup.md#permissions).

## Why not create/delete users or simulate logins?

There is no documented basis for treating simulated Auth activity as a more reliable solution. Creating and deleting users changes application state, may activate application-specific triggers or email flows, and deletion can require privileged access. An Auth response alone also does not verify a query against an application table. SupaBeacon intentionally performs no fake registrations, user deletion or login simulation, and requests no extra permissions for them. A bounded read is a much smaller operation for this purpose.

## How to assess it over time

Choose an authorized noncritical project, record the selected strategy and exact daily schedule, keep the server running, and inspect successful operations, authorization failures, provider status and warning emails over multiple weeks. Note other application/dashboard activity as a confounding factor. A short connectivity test cannot establish seven-day policy behavior; even a longer period without pausing is observational evidence, not a promise for other projects.

Keep production data private and avoid modifying a real workload merely to create a comparison. There is no automatic traffic escalation, auto-resume or hidden experiment in SupaBeacon. Manual runs add only the transparently configured number of minimal requests.

## Local verification on 16 October 2026

Read-only inspection of the configured instance found four discovered/monitored projects and one completed Management API execution with two successful HTTP 201 database responses, without stored execution errors.

A separate live verification used the already-authorized connection against one monitored project after checking ACTIVE_HEALTHY. The same fixed query returned HTTP 201 and the exact expected numeric heartbeat row in 882 ms at 14:34:36 UTC (16:34:36 Europe/Zurich). No project references, credentials or application table contents are included in this report. The test changed no schema, users or application data and did not refresh/replace credentials. It is a connectivity/query verification, not an app execution-history entry or a pausing-prevention test.

No multi-week pausing experiment or live Data API table test was performed. The default strategy remains unchanged for the user's configured projects; the optional Data API strategy now uses `limit=1` instead of an optimized zero-row `limit=0` query, without returning row bodies.
