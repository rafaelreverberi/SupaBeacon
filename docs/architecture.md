# Architecture

One Node.js process serves Fastify's REST API, the compiled React/Vite frontend and a persistent SQLite-backed scheduler. TypeScript strict mode spans server, client and shared validation. SQLite uses WAL, foreign keys, full synchronization and a five-second busy timeout. Versioned transactional migrations run before serving traffic.

## Modules

- `packages/shared/config.ts`: shared Zod contracts, defaults, budgets and provider-status rules.
- `apps/server/src/storage.ts`: prepared SQLite statements, transactional migrations and Drizzle settings persistence.
- `crypto.ts`: random values, state hashing and authenticated encryption.
- `supabase.ts`: fixed-origin provider transport, OAuth lifecycle, cooldown, discovery, selective publishable-key access.
- `schedule.ts`: local wall-time windows and retry delay policy.
- `engine.ts`: persisted jobs, atomic claims, execution locks, strategies and restart recovery.
- `app.ts`: authenticated REST routes, sessions, CSRF, configuration, history and diagnostics.
- `apps/web/src`: React, TanStack Query, Lucide, Recharts and accessible native controls with custom responsive CSS.

Custom CSS and native controls replace Tailwind/shadcn to avoid an unnecessary styling runtime/toolchain. No ORM-generated abstraction is used for critical job claims: prepared SQL and transactions express SQLite's locking and uniqueness constraints directly; Drizzle is used for typed key/value persistence. No Redis or external application database is required.

## Persisted records

Settings (including encrypted OAuth registration/tokens), singleton administrator, sessions, OAuth flows, projects/JSON overrides, scheduled jobs, executions, execution request attempts and sanitized logs. Audit events use the same append-only event table as operational logs; both follow configured retention. Authorization credentials are stored once rather than copied to project records. Projects remain available in history when visibility disappears.

## Scheduling

The configured IANA timezone controls local-day windows. With two random runs, one slot falls in each local half-day. Slots use keyed deterministic randomness over project/date/window so repeated planning is stable. There is a 10% margin at each window edge; there is no traffic escalation. Fixed schedules use explicit unique HH:mm times. Per-project frequency overrides in fixed mode use evenly distributed midpoint times if the global time count differs.

Luxon resolves nonexistent spring times forward and chooses one occurrence of an ambiguous autumn time. Unique project/due pairs avoid duplicated wall-time jobs. Timezone/configuration changes cancel pending jobs and plan fresh future slots. Restart retains pending slots; due jobs older than fifteen minutes are skipped. More recent jobs run under the normal concurrency cap. Only one pending future job per project is needed.

A scheduled job is marked running before any remote operation. A partial unique index prevents overlapping executions for the same project. Manual runs have separate IDs and do not consume or shift the recurring schedule. A crashed running execution becomes interrupted on startup, and its claimed job is not replayed. This is intentionally at-most-once recovery: exactly-once effects across a remote HTTP call and local power failure cannot be guaranteed. A crash before a remote request can skip one heartbeat, which is safer than replaying uncertain operations.

Retries are bounded in-memory within a claimed execution. Exponential delay and jitter respect Retry-After; a provider cooldown is also persisted in SQLite. Waits longer than 60 seconds finish the current run as failed and leave the cooldown in place. Restarts do not replay retry attempts. 401 refreshes once, 403 is not retried, and paused/unhealthy/unavailable projects are skipped. All traffic is limited to provider hosts derived from validated project references, with redirects prohibited and per-request timeouts.

The scheduler runs one process per data volume. Do not run replicas or separate development and production processes against the same SQLite file.

## Success semantics

Management strategy sends fixed `SELECT 1 AS heartbeat;` to the documented Beta read-only endpoint, then requires exactly one returned row with numeric heartbeat 1. An unfamiliar response format is a failure, not assumed success. Data strategy sends HEAD to a chosen existing table, returns no table contents, and checks successful PostgREST status plus Content-Range. Every attempt persists HTTP status, timestamp, latency, outcome and sanitized error code. Project status, request status, confirmed database operation and unverified pausing effectiveness are distinct.

The request budget describes configured database requests. Provider-status checks, discovery, publishable-key metadata/reveal calls and OAuth refresh add HTTP overhead. The Data API implementation intentionally trades a few metadata calls for never caching project credentials.

## Polling and retention

Dashboard/project data poll every 3–5 seconds; OAuth status every 15 seconds. Log auto-refresh is optional at five seconds. Paging limits reads to thirty rows; log export is capped at 10,000 matching rows. Hourly pruning removes expired sessions/states and old completed executions, request details, jobs and events. Startup also prunes. SQLite reuses freed pages; backup/restore can compact historical space. Schema migrations support later application versions.

## Optional per-project checks

Migration 2 adds a project_activity record per configured project, encrypted write-only dedicated-account credentials, a durable session-review flag and separate optional request counters/kinds. Defaults are off, including for projects discovered after the feature is enabled elsewhere. `activity.ts` runs bounded GET reads of one selected column and optionally wraps them in one password sign-in/local-scope sign-out. It runs only after a successful complete primary heartbeat. Returned values/tokens never enter SQLite, APIs or logs; selected JSON bodies are capped at 64 KiB and validated.

Before sign-in the durable session-review flag is set. Definitive login rejection or confirmed local logout clears it. Network ambiguity, failed logout or a crash preserves it, blocking further sign-ins until explicit operator review. Logout bypasses an existing local provider cooldown solely to attempt session cleanup; its own 429 still updates the cooldown. No global logout, signup, user deletion, browser impersonation or extra permission is triggered automatically. Optional activity is not retried. The normal heartbeat schedule/budget remains separate.
